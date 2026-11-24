import { createPortal } from 'react-dom';

/**
 * Renders children via a React Portal attached to document.body.
 *
 * Framer-motion's AnimatedPage applies `transform` + `will-change`,
 * which creates a new containing block that traps `fixed`-positioned
 * descendants. Portalling to <body> escapes that context so modals
 * overlay the full viewport as intended.
 */
export default function ModalPortal({ children }) {
  return createPortal(children, document.body);
}
