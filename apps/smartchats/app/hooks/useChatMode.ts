'use client';

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useSmartChatsStore } from '../store/useSmartChatsStore';

/**
 * useChatMode — Manages text-based chat mode state and interactions.
 * Chat input state lives in the store; this hook adds DOM-only concerns
 * (container ref, auto-scroll, keypress handler).
 */

export interface ChatModeState {
    chatInput: string;
    setChatInput: (v: string) => void;
    isAiTyping: boolean;
    handleChatSend: () => void;
    handleChatKeyPress: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    chatContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useChatMode(): ChatModeState {
    const chatInput = useSmartChatsStore((s) => s.chatInput);
    const setChatInput = useSmartChatsStore((s) => s.setChatInput);
    const sendChatMessage = useSmartChatsStore((s) => s.sendChatMessage);
    const chatHistory = useSmartChatsStore((s) => s.chatHistory);
    const chatContainerRef = useRef<HTMLDivElement | null>(null);

    const isAiTyping = chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user';

    // Auto-scroll
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);

    const handleChatSend = useCallback(() => { sendChatMessage(); }, [sendChatMessage]);

    const handleChatKeyPress = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    }, [sendChatMessage]);

    return useMemo(() => ({
        chatInput,
        setChatInput,
        isAiTyping,
        handleChatSend,
        handleChatKeyPress,
        chatContainerRef,
    }), [chatInput, isAiTyping, handleChatSend, handleChatKeyPress]);
}
