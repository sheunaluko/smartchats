'use client';

import React from 'react';
import { ChatComposer } from '../ui/recipes/ChatComposer';
import { MessageBubble } from '../ui/recipes/MessageBubble';

interface ChatModeViewProps {
    chatHistory: Array<{ role: string; content: string }>;
    chatInput: string;
    setChatInput: (v: string) => void;
    isAiTyping: boolean;
    handleChatSend: () => void;
    handleChatKeyPress: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    chatContainerRef: React.RefObject<HTMLDivElement | null>;
}

export const ChatModeView = React.memo(function ChatModeView({
    chatHistory,
    chatInput,
    setChatInput,
    isAiTyping,
    handleChatSend,
    handleChatKeyPress,
    chatContainerRef,
}: ChatModeViewProps) {
    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <div className="border-b border-sc-border/55 bg-[color-mix(in_srgb,var(--sc-surface)_82%,transparent)] backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
                    <div>
                        <h2 className="text-base font-semibold tracking-[-0.01em] text-sc-text">
                            Conversation
                        </h2>
                        <p className="mt-1 text-[0.95rem] text-sc-text-muted">
                            Message the agent directly without leaving the workspace.
                        </p>
                    </div>
                    <div className="hidden rounded-full border border-sc-border/50 bg-[color-mix(in_srgb,var(--sc-surface)_74%,transparent)] px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.11em] text-sc-text-muted md:block">
                        {chatHistory.length > 1 ? `${chatHistory.length - 1} messages` : 'No messages yet'}
                    </div>
                </div>
            </div>

            <div
                ref={chatContainerRef as React.RefObject<HTMLDivElement>}
                className="flex-1 min-w-full overflow-y-auto scrollbar-thin"
            >
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
                    {chatHistory.length <= 1 && (
                        <div className="rounded-[24px] border border-dashed border-sc-border/55 bg-[color-mix(in_srgb,var(--sc-surface)_74%,transparent)] px-5 py-8 text-center text-[0.95rem] text-sc-text-muted">
                            Start the conversation. The chat surface is now tied to the shared recipe layer, so message hierarchy stays consistent across packs.
                        </div>
                    )}

                    {chatHistory.slice(1).map((message, index) => (
                        <MessageBubble
                            key={index}
                            role={message.role}
                            content={message.content}
                            className="animate-sc-slide-in-up"
                        />
                    ))}

                    {isAiTyping && (
                        <div className="flex justify-start">
                            <div className="rounded-full border border-sc-primary/30 bg-sc-primary/10 px-4 py-2 text-xs uppercase tracking-[0.14em] text-sc-primary animate-sc-fade-in">
                                SmartChats is responding…
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="border-t border-sc-border/55 bg-[color-mix(in_srgb,var(--sc-surface)_84%,transparent)] backdrop-blur-md">
                <div className="mx-auto w-full max-w-5xl px-4 py-4">
                    <ChatComposer
                        value={chatInput}
                        onChange={setChatInput}
                        onSend={handleChatSend}
                        onKeyDown={handleChatKeyPress}
                    />
                </div>
            </div>
        </div>
    );
});
