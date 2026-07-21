// TurboPay WebSocket Service
// Real-time notifications for transactions, payments, and system events
//
// NOTE: Install 'socket.io' package to use this module: npm install socket.io

import { getLogger } from '../utils/logger';

// Dynamic import types (avoid requiring socket.io at module load)
type HttpServer = any;
type SocketServer = any;
type Socket = any;

// =============================================================================
// TYPES
// =============================================================================

export interface WSMessage {
  type: 'notification' | 'transaction' | 'balance' | 'system' | 'ping';
  data: any;
  timestamp: Date;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  read: boolean;
  created_at: Date;
}

// =============================================================================
// WEBSOCKET SERVICE
// =============================================================================

export class WebSocketService {
  private io: SocketServer | null = null;
  private logger = getLogger();
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  init(httpServer: HttpServer): void {
    try {
      // Dynamic import to avoid requiring socket.io at module load
      const { Server: SocketIOServer } = require('socket.io');
      this.io = new SocketIOServer(httpServer, {
        cors: {
          origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || '*',
          methods: ['GET', 'POST']
        },
        path: '/ws',
        transports: ['websocket', 'polling']
      });

      this.io.on('connection', (socket: any) => {
      this.logger.info('WebSocket connected', { socketId: socket.id });

      // Handle authentication
      socket.on('authenticate', (token: string) => {
        this.handleAuthentication(socket, token);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Handle ping
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date() });
      });
    });

    this.logger.info('WebSocket service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize WebSocket', error);
    }
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  private handleAuthentication(socket: Socket, token: string): void {
    // TODO: Validate token and extract user ID
    // For now, use a mock userId
    const userId = this.extractUserIdFromToken(token);
    
    if (userId) {
      // Track user socket
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);

      // Join user's room
      socket.join(`user:${userId}`);

      socket.emit('authenticated', { userId });
      this.logger.info('WebSocket authenticated', { userId, socketId: socket.id });
    } else {
      socket.emit('authentication_error', { error: 'Invalid token' });
    }
  }

  private extractUserIdFromToken(token: string): string | null {
    // TODO: Implement proper JWT validation
    // For now, return a mock userId
    return 'user_123';
  }

  private handleDisconnect(socket: Socket): void {
    // Remove socket from user tracking
    for (const [userId, sockets] of this.userSockets.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }
        break;
      }
    }
    this.logger.info('WebSocket disconnected', { socketId: socket.id });
  }

  // ===========================================================================
  // SEND MESSAGES
  // ===========================================================================

  /**
   * Send notification to a specific user
   */
  sendToUser(userId: string, notification: Omit<Notification, 'id' | 'created_at'>): void {
    if (!this.io) return;

    const fullNotification: Notification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      created_at: new Date()
    };

    this.io.to(`user:${userId}`).emit('notification', fullNotification);
    this.logger.debug('Notification sent', { userId, type: notification.type });
  }

  /**
   * Send transaction update to a specific user
   */
  sendTransactionUpdate(userId: string, transaction: any): void {
    if (!this.io) return;

    this.io.to(`user:${userId}`).emit('transaction', {
      type: 'transaction_update',
      data: transaction,
      timestamp: new Date()
    });
  }

  /**
   * Send balance update to a specific user
   */
  sendBalanceUpdate(userId: string, balance: { currency: string; amount: number }): void {
    if (!this.io) return;

    this.io.to(`user:${userId}`).emit('balance', {
      type: 'balance_update',
      data: balance,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast system message to all connected users
   */
  broadcastSystem(message: string, data?: any): void {
    if (!this.io) return;

    this.io.emit('system', {
      type: 'system',
      data: { message, ...data },
      timestamp: new Date()
    });
  }

  /**
   * Send message to admin room
   */
  sendToAdmins(event: string, data: any): void {
    if (!this.io) return;

    this.io.to('admin').emit(event, {
      type: event,
      data,
      timestamp: new Date()
    });
  }

  // ===========================================================================
  // ROOM MANAGEMENT
  // ===========================================================================

  joinRoom(socketId: string, room: string): void {
    const socket = this.io?.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(room);
    }
  }

  leaveRoom(socketId: string, room: string): void {
    const socket = this.io?.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(room);
    }
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  getConnectedUsers(): number {
    return this.userSockets.size;
  }

  getConnectedSockets(): number {
    return this.io?.sockets.sockets.size || 0;
  }

  getUserSockets(userId: string): string[] {
    return Array.from(this.userSockets.get(userId) || []);
  }

  // ===========================================================================
  // SHUTDOWN
  // ===========================================================================

  close(): void {
    if (this.io) {
      this.io.close();
      this.io = null;
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let wsInstance: WebSocketService | null = null;

export function getWebSocket(): WebSocketService {
  if (!wsInstance) {
    wsInstance = new WebSocketService();
  }
  return wsInstance;
}

export default WebSocketService;
