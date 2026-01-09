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

  const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
  const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "eu";

  const connect = useCallback(() => {
    if (!isActiveRef.current || !PUSHER_KEY) {
      setError("Pusher not configured - missing NEXT_PUBLIC_PUSHER_KEY");
      onError?.("Pusher not configured");
      return;
    }

    if (!token) {
      setError("No authentication token");
      onError?.("No authentication token");
      return;
    }

    if (pusherRef.current) {
      pusherRef.current.disconnect();
    }

    try {
      const authEndpoint = `${apiBase}/api/pusher/auth?token=${encodeURIComponent(token)}${supportUserId ? `&supportUserId=${encodeURIComponent(supportUserId)}` : ""}`;
      
      const pusher = new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: authEndpoint,
        auth: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });

      pusher.connection.bind("connected", () => {
        setIsConnected(true);
        setError(null);
        onConnect?.();
      });

      pusher.connection.bind("disconnected", () => {
        setIsConnected(false);
        onDisconnect?.();
      });

      pusher.connection.bind("error", (err: any) => {
        setError("Pusher connection error");
        onError?.("Connection error");
      });

      let channelName = "";
      if (streamType === "tickets" || streamType === "transactions") {
        channelName = `private-user-${userId}`;
      } else if (streamType === "ticket-messages" && ticketId) {
        channelName = `private-ticket-${ticketId}`;
      }

      if (channelName) {
        const channel = pusher.subscribe(channelName);

        channel.bind("pusher:subscription_succeeded", () => {
          setIsConnected(true);
        });

        channel.bind("pusher:subscription_error", (status: number) => {
          setError(`Subscription failed: ${status}`);
          onError?.(`Subscription failed`);
        });

        if (streamType === "tickets") {
          channel.bind("ticket", (data: any) => {
            onMessage?.({ type: "ticket", data });
          });
        } else if (streamType === "ticket-messages") {
          channel.bind("message", (data: any) => {
            onMessage?.(data);
          });
          channel.bind("status", (data: any) => {
            onMessage?.(data);
          });
        } else if (streamType === "transactions") {
          channel.bind("transaction", (data: any) => {
            onMessage?.(data);
          });
        }

        channelRef.current = channel;
      }

      pusherRef.current = pusher;
    } catch (err) {
      setError("Failed to create Pusher connection");
      onError?.("Failed to create connection");
    }
  }, [apiBase, token, userId, supportUserId, streamType, ticketId, PUSHER_KEY, PUSHER_CLUSTER, onMessage, onError, onConnect, onDisconnect]);

  const disconnect = useCallback(() => {
    isActiveRef.current = false;
    if (channelRef.current) {
      pusherRef.current?.unsubscribe(channelRef.current.name);
      channelRef.current = null;
    }
    if (pusherRef.current) {
      pusherRef.current.disconnect();
      pusherRef.current = null;
    }
    setIsConnected(false);
    onDisconnect?.();
  }, [onDisconnect]);

  useEffect(() => {
    isActiveRef.current = true;
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { isConnected, error, reconnect: connect, disconnect };
}
