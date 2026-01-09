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

      let channelName = "";
      if (streamType === "tickets" || streamType === "transactions") {
        channelName = `private-user-${userId}`;
      } else if (streamType === "ticket-messages" && ticketId) {
        channelName = `private-ticket-${ticketId}`;
      }

      pusher.connection.bind("connected", () => {
        if (channelName) {
          const channel = pusher.subscribe(channelName);

          channel.bind("pusher:subscription_succeeded", () => {
            setIsConnected(true);
            setError(null);
            onConnect?.();
          });

          channel.bind("pusher:subscription_error", (status: number, data?: any) => {
            setError(`Subscription failed: ${status} - ${data?.error || "Unknown error"}`);
            onError?.(`Subscription failed: ${status}`);
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
        } else {
          setIsConnected(true);
          setError(null);
          onConnect?.();
        }
      });

      pusher.connection.bind("disconnected", () => {
        setIsConnected(false);
        onDisconnect?.();
      });

      pusher.connection.bind("error", (err: any) => {
        setError(`Pusher connection error: ${err?.error?.data?.message || err?.message || "Unknown error"}`);
        onError?.(`Connection error: ${err?.error?.data?.message || err?.message || "Unknown error"}`);
      });

      if (channelName && pusher.connection.state === "connected") {
        const channel = pusher.subscribe(channelName);

        channel.bind("pusher:subscription_succeeded", () => {
          setIsConnected(true);
          setError(null);
          onConnect?.();
        });

        channel.bind("pusher:subscription_error", (status: number, data?: any) => {
          setError(`Subscription failed: ${status} - ${data?.error || "Unknown error"}`);
          onError?.(`Subscription failed: ${status}`);
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
