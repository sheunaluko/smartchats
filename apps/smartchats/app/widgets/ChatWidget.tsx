'use client';

import React from 'react';
import WidgetItem from '../WidgetItem';
import { MessageBubble } from '../ui/recipes/MessageBubble';

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  chatHistory: ChatMessage[];
}

const ChatWidget: React.FC<ChatWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  chatHistory
}) => {

  return (
    <WidgetItem
      title="Chat"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="chat_display" className="scrollbar-hide flex max-h-[95%] flex-col gap-3 overflow-y-auto">
        {chatHistory.filter(m => {
          if (m.role === 'system' || m.role === 'viz') return false;
          if (m.role === 'user') {
            if (!m.content) return false;
            try { const p = JSON.parse(m.content); if (p.type !== 'text') return false; } catch {}
          }
          return true;
        }).map((message, index) => (
          <MessageBubble
            key={index}
            role={message.role}
            content={message.content}
          />
        ))}
      </div>
    </WidgetItem>
  );
};

export default React.memo(ChatWidget);
