// TurboPay WebSocket Hook
// Client-side WebSocket connection for real-time updates

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

type MessageHandler = (data: any) => void;

interface UseWebSocketOptions {
  url?: string;
  token?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onNotification?: MessageHandler;
  onTransaction?: MessageHandler;
  onBalance?: MessageHandler;
  onSystem?: MessageHandler;
  autoConnect?: boolean;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws',
    token,
    onConnect,
    onDisconnect,
    onNotification,
    onTransaction,
    onBalance,
    onSystem,
    autoConnect = true
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ===========================================================================
  // CONNECT
  // ===========================================================================

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setReconnectAttempts(0);
        onConnect?.();

        // Authenticate
        if (token) {
          ws.send(JSON.stringify({ type: 'authenticate', token }));
        }
      };

      ws.onclose = () => {
        setConnected(false);
        onDisconnect?.();

        // Auto reconnect with exponential backoff
        if (autoConnect && reconnectAttempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'notification':
              onNotification?.(message.data);
              break;
            case 'transaction':
              onTransaction?.(message.data);
              break;
            case 'balance':
              onBalance?.(message.data);
              break;
            case 'system':
              onSystem?.(message.data);
              break;
            case 'pong':
              // Handle pong
              break;
            default:
              console.log('Unknown message type:', message.type);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, [url, token, onConnect, onDisconnect, onNotification, onTransaction, onBalance, onSystem, autoConnect, reconnectAttempts]);

  // ===========================================================================
  // DISCONNECT
  // ===========================================================================

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  // ===========================================================================
  // SEND
  // ===========================================================================

  const send = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect]);

  // ===========================================================================
  // HEARTBEAT
  // ===========================================================================

  useEffect(() => {
    if (!connected) return;

    const interval = setInterval(() => {
      send('ping', {});
    }, 30000);

    return () => clearInterval(interval);
  }, [connected, send]);

  return {
    connected,
    connect,
    disconnect,
    send
  };
}

export default useWebSocket;
