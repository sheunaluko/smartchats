'use client';

import React, { useState, useEffect, useRef } from 'react';
import WidgetItem from '../WidgetItem';
import { logger } from 'smartchats-common';
import { ChatComposer } from '../ui/recipes/ChatComposer';

const log = logger.get_logger({ id: "cortex:ChatInputWidget" });

interface ChatInputWidgetProps {
  onSubmit: (text: string) => void;
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
}

let renderCount = 0;

const ChatInputWidget: React.FC<ChatInputWidgetProps> = ({
  onSubmit,
  fullscreen = false,
  onFocus,
  onClose,
}) => {
  renderCount++;
  log(`[DEBUG] ChatInputWidget render #${renderCount}, fullscreen: ${fullscreen}`);

  const [input, setInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Monitor DOM mutations in this widget
  useEffect(() => {
    log(`[DEBUG] ChatInputWidget mounted/updated`);

    if (!containerRef.current) return;

    let addCount = 0;
    let removeCount = 0;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        addCount += mutation.addedNodes.length;
        removeCount += mutation.removedNodes.length;

        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              log(`[DOM-LEAK] ChatInput added: ${el.tagName}.${el.className || ''}`);
            }
          });
        }
      });
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true
    });

    const interval = setInterval(() => {
      if (addCount > 0 || removeCount > 0) {
        log(`[DOM-LEAK] ChatInput mutations: +${addCount} -${removeCount} = ${addCount - removeCount}`);
        addCount = 0;
        removeCount = 0;
      }
    }, 3000);

    return () => {
      observer.disconnect();
      clearInterval(interval);
      log(`[DEBUG] ChatInputWidget unmounted`);
    };
  }, [fullscreen]);

  const handleSend = () => {
    if (input.trim()) {
      onSubmit(input.trim());
      setInput(''); // Clear input after sending
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <WidgetItem
      title="Chat Input"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div
        ref={containerRef}
        className="h-full p-2"
      >
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onKeyDown={handleKeyPress}
        />
      </div>
    </WidgetItem>
  );
};

export default React.memo(ChatInputWidget);
