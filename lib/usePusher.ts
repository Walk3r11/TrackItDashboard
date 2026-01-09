"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Pusher from "pusher-js";

type PusherMessage = {
  type: string;
  data?: any;
  error?: string;
};

type UsePusherOptions = {
  apiBase: string;
  token: string;
  userId?: string;
  supportUserId?: string;
  streamType: "tickets" | "ticket-messages" | "transactions";
  ticketId?: string;
  onMessage?: (message: PusherMessage) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function usePusher({
  apiBase,
  token,
  userId,
  supportUserId,
  streamType,
  ticketId,
  onMessage,
  onError,
  onConnect,
  onDisconnect,
}: UsePusherOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<any>(null);
  const isActiveRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
  }, [onMessage, onError, onConnect, onDisconnect]);

  const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
  const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "eu";

  const connect = useCallback(() => {
    if (!isActiveRef.current || !PUSHER_KEY) {
      setError("Pusher not configured - missing NEXT_PUBLIC_PUSHER_KEY");
      onErrorRef.current?.("Pusher not configured");
      return;
    }

    if (!token) {
      setError("No authentication token");
      onErrorRef.current?.("No authentication token");
      return;
    }

    if (pusherRef.current) {
      try {
        const state = pusherRef.current.connection.state;
        if (state === "connected" || state === "connecting") {
          pusherRef.current.disconnect();
        }
      } catch (err) {
      }
    }

    try {
      const authEndpoint = `${apiBase}/api/pusher/auth?token=${encodeURIComponent(token)}${supportUserId ? `&supportUserId=${encodeURIComponent(supportUserId)}` : ""}`;
      
      const originalError = console.error;
      const errorFilter = (...args: any[]) => {
        const message = args.join(" ").toLowerCase();
        if (message.includes("websocket is closed before the connection is established") ||
            message.includes("connection closed")) {
          return;
        }
        originalError.apply(console, args);
      };
      console.error = errorFilter;
      
      const pusher = new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: authEndpoint,
        auth: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        enabledTransports: ['ws', 'wss'],
      });
      
      setTimeout(() => {
        console.error = originalError;
      }, 2000);

      let channelName = "";
      if (streamType === "tickets" || streamType === "transactions") {
        channelName = `private-user-${userId}`;
      } else if (streamType === "ticket-messages" && ticketId) {
        channelName = `private-ticket-${ticketId}`;
      }

      const setupChannel = () => {
        if (!channelName) {
          setIsConnected(true);
          setError(null);
          onConnectRef.current?.();
          return;
        }

        if (channelRef.current) {
          return;
        }

        const channel = pusher.subscribe(channelName);

        channel.bind("pusher:subscription_succeeded", () => {
          setIsConnected(true);
          setError(null);
          onConnectRef.current?.();
        });
        
        channel.bind("pusher:subscription_error", (status: number, data?: any) => {
          setError(`Subscription failed: ${status} - ${data?.error || "Unknown error"}`);
          onErrorRef.current?.(`Subscription failed: ${status}`);
        });

        if (streamType === "tickets") {
          channel.bind("ticket", (data: any) => {
            onMessageRef.current?.({ type: "ticket", data });
          });
        } else if (streamType === "ticket-messages") {
          channel.bind("message", (data: any) => {
            if (onMessageRef.current) {
              onMessageRef.current(data);
            }
          });
          channel.bind("status", (data: any) => {
            if (onMessageRef.current) {
              onMessageRef.current(data);
            }
          });
        } else if (streamType === "transactions") {
          channel.bind("transaction", (data: any) => {
            onMessageRef.current?.(data);
          });
        }

        channelRef.current = channel;
      };

      const handleConnected = () => {
        if (!channelRef.current) {
          setupChannel();
        }
      };

      pusher.connection.bind("connected", handleConnected);
      pusher.connection.bind("disconnected", () => {
        setIsConnected(false);
        channelRef.current = null;
        onDisconnectRef.current?.();
      });
      pusher.connection.bind("error", (err: any) => {
        if (isActiveRef.current) {
          const errorMsg = err?.error?.data?.message || err?.message || err?.error?.message || "Unknown error";
          const errorString = String(errorMsg).toLowerCase();
          if (!errorString.includes("websocket is closed") && 
              !errorString.includes("before the connection is established") &&
              !errorString.includes("connection closed")) {
            setError(`Pusher connection error: ${errorMsg}`);
            onErrorRef.current?.(`Connection error: ${errorMsg}`);
          }
        }
      });

      if (pusher.connection.state === "connected") {
        handleConnected();
      }

      pusherRef.current = pusher;
    } catch (err) {
      setError("Failed to create Pusher connection");
      onErrorRef.current?.("Failed to create connection");
    }
  }, [apiBase, token, userId, supportUserId, streamType, ticketId, PUSHER_KEY, PUSHER_CLUSTER]);

  const disconnect = useCallback(() => {
    isActiveRef.current = false;
    if (channelRef.current) {
      try {
        pusherRef.current?.unsubscribe(channelRef.current.name);
      } catch (err) {
      }
      channelRef.current = null;
    }
    if (pusherRef.current) {
      try {
        const state = pusherRef.current.connection.state;
        if (state === "connected" || state === "connecting") {
          pusherRef.current.disconnect();
        }
      } catch (err) {
      }
      pusherRef.current = null;
    }
    setIsConnected(false);
    onDisconnectRef.current?.();
  }, []);

  useEffect(() => {
    isActiveRef.current = true;
    connect();
    
    return () => {
      disconnect();
    };
  }, [apiBase, token, userId, supportUserId, streamType, ticketId]);

  return { isConnected, error, reconnect: connect, disconnect };
}
