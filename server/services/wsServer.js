import ws from 'ws';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const { Server: WebSocketServer } = ws;

// WebSocket readyState constants
const WebSocketReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

let wss = null;
const userSockets = new Map(); // userId -> Set<WebSocket>
const pendingAuth = new Map(); // WebSocket -> timeoutId
const conversationRooms = new Map(); // conversationId -> Set<WebSocket>
const wsConversations = new Map(); // WebSocket -> Set<conversationId>

export function initWebSocketServer(server) {
  if (env.WEBSOCKET_ENABLED === false) {
    logger.info('WebSocket server disabled via config');
    return null;
  }

  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    logger.debug({ clientIp }, 'WebSocket connection attempt');

    // Set 10s timeout for authentication
    const authTimeout = setTimeout(() => {
      if (pendingAuth.has(ws)) {
        logger.debug({ clientIp }, 'WebSocket auth timeout, closing connection');
        ws.close(4008, 'Authentication timeout');
        pendingAuth.delete(ws);
      }
    }, 10000);
    pendingAuth.set(ws, authTimeout);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'auth' && message.token) {
          clearTimeout(pendingAuth.get(ws));
          pendingAuth.delete(ws);
          
          try {
            const decoded = jwt.verify(message.token, env.JWT_SECRET);
            const userId = decoded.id;
            
            // Bind socket to user
            ws.userId = userId;
            if (!userSockets.has(userId)) {
              userSockets.set(userId, new Set());
            }
            userSockets.get(userId).add(ws);
            
            logger.info({ userId, clientIp }, 'WebSocket authenticated');
            ws.send(JSON.stringify({ type: 'auth:ok' }));
          } catch (err) {
            logger.warn({ err, clientIp }, 'WebSocket auth failed');
            ws.close(4001, 'Invalid token');
          }
        } else if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (message.type === 'conversation:join' && message.conversationId && ws.userId) {
          joinConversation(ws, message.conversationId);
        } else if (message.type === 'conversation:leave' && message.conversationId && ws.userId) {
          leaveConversation(ws, message.conversationId);
        } else if (message.type === 'conversation:typing' && message.conversationId && ws.userId) {
          broadcastToConversation(message.conversationId, {
            type: 'conversation:typing',
            conversationId: message.conversationId,
            userId: ws.userId,
          }, ws);
        }
      } catch (err) {
        logger.warn({ err, clientIp }, 'WebSocket message parse error');
      }
    });

    ws.on('close', () => {
      if (pendingAuth.has(ws)) {
        clearTimeout(pendingAuth.get(ws));
        pendingAuth.delete(ws);
      }
      if (ws.userId && userSockets.has(ws.userId)) {
        userSockets.get(ws.userId).delete(ws);
        if (userSockets.get(ws.userId).size === 0) {
          userSockets.delete(ws.userId);
        }
      }
      cleanupWsConversations(ws);
    });

    ws.on('error', (err) => {
      logger.error({ err, clientIp }, 'WebSocket error');
    });
  });

  // Heartbeat: ping all sockets every 30s
  const heartbeatInterval = setInterval(() => {
    for (const [userId, sockets] of userSockets) {
      for (const ws of sockets) {
if (ws.readyState === WebSocketReadyState.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          sockets.delete(ws);
        }
      }
      if (sockets.size === 0) {
        userSockets.delete(userId);
      }
    }
  }, 30000);
  heartbeatInterval.unref();

  wss.on('error', (err) => {
    logger.error({ err }, 'WebSocket server error');
  });

  logger.info('WebSocket server initialized on /ws');
  return wss;
}

export function pushToUser(userId, notification) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;

  const message = JSON.stringify({ type: 'notification', data: notification });
  for (const ws of sockets) {
    if (ws.readyState === WebSocketReadyState.OPEN) {
      try {
        ws.send(message);
      } catch (err) {
        logger.error({ err, userId }, 'Failed to push notification via WebSocket');
      }
    }
  }
}

/** Push the user's total unread-conversation count (nav badge live updates). */
export function pushUnreadCount(userId, count) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;

  const message = JSON.stringify({ type: 'conversation:unread-count', data: { count } });
  for (const ws of sockets) {
    if (ws.readyState === WebSocketReadyState.OPEN) {
      try {
        ws.send(message);
      } catch (err) {
        logger.error({ err, userId }, 'Failed to push unread count via WebSocket');
      }
    }
  }
}

export function pushBackupProgress(userId, progress) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;

  const message = JSON.stringify({ type: 'backup:progress', data: progress });
  for (const ws of sockets) {
    if (ws.readyState === WebSocketReadyState.OPEN) {
      try {
        ws.send(message);
      } catch (err) {
        logger.error({ err, userId }, 'Failed to push backup progress');
      }
    }
  }
}

export function closeAllSockets() {
  for (const [_userId, sockets] of userSockets) {
    for (const ws of sockets) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {}
    }
  }
  userSockets.clear();
  
  if (wss) {
    wss.close();
    wss = null;
  }
}

export function getConnectedUserCount() {
  return userSockets.size;
}

/**
 * Room-key normalizer. Callers disagree on type: HTTP routes pass the RAW
 * route param ("204"), clients join with the JSON number (204), and broadcast
 * sites pass SQLite row ids (number). Map keys are SameValueZero, so those
 * never matched — sendMessage's `conversation:message` frames went to a room
 * nobody had joined and live delivery silently no-oped while edited/deleted
 * frames (numeric ids) worked. Coerce once, at the boundary.
 */
function roomKey(conversationId) {
  return Number(conversationId);
}

export function joinConversation(ws, conversationId) {
  const key = roomKey(conversationId);
  if (!conversationRooms.has(key)) {
    conversationRooms.set(key, new Set());
  }
  conversationRooms.get(key).add(ws);

  if (!wsConversations.has(ws)) {
    wsConversations.set(ws, new Set());
  }
  wsConversations.get(ws).add(key);
}

export function leaveConversation(ws, conversationId) {
  const key = roomKey(conversationId);
  const room = conversationRooms.get(key);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      conversationRooms.delete(key);
    }
  }
  const wsConvs = wsConversations.get(ws);
  if (wsConvs) {
    wsConvs.delete(key);
    if (wsConvs.size === 0) {
      wsConversations.delete(ws);
    }
  }
}

function cleanupWsConversations(ws) {
  const convs = wsConversations.get(ws);
  if (convs) {
    for (const convId of convs) {
      const room = conversationRooms.get(convId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          conversationRooms.delete(convId);
        }
      }
    }
    wsConversations.delete(ws);
  }
}

export function broadcastToConversation(conversationId, data, excludeWs = null) {
  const room = conversationRooms.get(roomKey(conversationId));
  if (!room) return;

  const message = JSON.stringify(data);
  for (const ws of room) {
    if (ws !== excludeWs && ws.readyState === WebSocketReadyState.OPEN) {
      try {
        ws.send(message);
      } catch (err) {
        logger.error({ err, conversationId }, 'Failed to broadcast to conversation');
      }
    }
  }
}