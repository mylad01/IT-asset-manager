import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/apiClient';
import { getWebSocketUrl } from '../utils/wsUrl';
import { getStoredToken, getStoredUser } from '../utils/appStorage';

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [convUnreadCount, setConvUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  // /api/conversations/unread-count is admin-gated server-side; polling it
  // as Staff/Read-Only only spams 403s (the Sidebar badge that consumes it
  // is admin-only too). Conversations are an IT-Admin feature.
  const isAdminUser = (() => {
    try {
      return getStoredUser()?.role === 'IT Admin';
    } catch {
      return false;
    }
  })();
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const pollIntervalRef = useRef(null);
  const subscribersRef = useRef(new Set());
  const mountedRef = useRef(true);
  const connIdRef = useRef(0);
  
  const WS_URL = getWebSocketUrl('/ws');
  
  const notifySubscribers = useCallback((type, data) => {
    subscribersRef.current.forEach(cb => cb(type, data));
  }, []);
  
  const subscribe = useCallback((callback) => {
    subscribersRef.current.add(callback);
    return () => subscribersRef.current.delete(callback);
  }, []);
  
  const fetchNotifications = useCallback(async () => {
    const { ok, data } = await api.get('/api/notifications', { showToast: false });
    if (ok && Array.isArray(data)) {
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.is_read).length);
    }
  }, []);

  const fetchConvUnreadCount = useCallback(async () => {
    if (!isAdminUser) return;
    const { ok, data } = await api.get('/api/conversations/unread-count', { showToast: false });
    if (ok && data && typeof data.count === 'number') {
      setConvUnreadCount(data.count);
    }
  }, [isAdminUser]);
  
  const startPolling = useCallback(() => {
    setIsPolling(prev => {
      if (prev) return prev;
      return true;
    });
    
    const poll = async () => {
      if (!mountedRef.current) return;
      await fetchNotifications();
    };
    
    poll();
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(poll, 15000);
  }, [fetchNotifications]);
  
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!mountedRef.current) return;
    
    const token = getStoredToken();
    if (!token) return;
    
    // Clean up any existing connection first
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    
    const myId = ++connIdRef.current;
    
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      
      ws.onopen = () => {
        if (!mountedRef.current || connIdRef.current !== myId) { try { ws.close(); } catch {} return; }
        ws.send(JSON.stringify({ type: 'auth', token }));
      };
      
      ws.onmessage = (event) => {
        if (connIdRef.current !== myId) return;
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'auth:ok') {
            setIsConnected(true);
            setIsPolling(false);
            reconnectAttemptsRef.current = 0;
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          } else if (message.type === 'notification') {
            const newNotif = message.data;
            setNotifications(prev => [newNotif, ...prev.slice(0, 49)]);
            setUnreadCount(prev => prev + 1);
            notifySubscribers('notification', newNotif);
          } else if (message.type === 'conversation:unread-count') {
            setConvUnreadCount(typeof message.data?.count === 'number' ? message.data.count : 0);
          } else if (message.type === 'backup:progress') {
            notifySubscribers('backup:progress', message.data);
          }
        } catch (err) {
          console.warn('WS message parse error:', err);
        }
      };
      
      ws.onclose = () => {
        if (connIdRef.current !== myId) return;
        if (!mountedRef.current) return;
        setIsConnected(false);
        wsRef.current = null;
        
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          if (reconnectAttemptsRef.current > 5) {
            startPolling();
          } else {
            connectWebSocket();
          }
        }, delay);
      };
      
      ws.onerror = () => {};
    } catch {
    }
  }, [WS_URL, notifySubscribers, startPolling]);
  
  useEffect(() => {
    mountedRef.current = true;
    connectWebSocket();
    fetchNotifications();
    fetchConvUnreadCount();

    return () => {
      mountedRef.current = false; // eslint-disable-line react-hooks/exhaustive-deps -- state ref, not DOM ref
      connIdRef.current++; // eslint-disable-line react-hooks/exhaustive-deps
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current = null;
      stopPolling();
    };
  }, [connectWebSocket, fetchNotifications, fetchConvUnreadCount, stopPolling]);
  
  const dismiss = useCallback(async (id) => {
    const { ok } = await api.put(`/api/notifications/${id}/dismiss`);
    if (ok) {
      setNotifications(prev => prev.filter(n => n.id !== id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    return ok;
  }, []);
  
  const snooze = useCallback(async (id, hours = 24) => {
    const { ok } = await api.put(`/api/notifications/${id}/snooze`, { hours });
    if (ok) {
      setNotifications(prev => prev.filter(n => n.id !== id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    return ok;
  }, []);
  
  const markAllRead = useCallback(async () => {
    const { ok } = await api.put('/api/notifications/mark-all-read');
    if (ok) {
      setNotifications([]);
      setUnreadCount(0);
    }
    return ok;
  }, []);
  
  return {
    notifications,
    unreadCount,
    convUnreadCount,
    isConnected,
    isPolling,
    dismiss,
    snooze,
    markAllRead,
    subscribe,
    refresh: fetchNotifications,
    refreshConvUnreadCount: fetchConvUnreadCount,
  };
}
