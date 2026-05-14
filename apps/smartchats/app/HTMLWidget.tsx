'use client';

import React, { useState, useEffect } from 'react';

import { logger, fp, debug } from 'smartchats-common';

const log    = logger.get_logger({id:"html"});



const HTMLWidget = ({to_display   } : any) => {

    // Generate secure srcdoc with sandboxed iframe
    // The iframe isolates user HTML and provides store_in_workspace bridge
    const srcdoc = React.useMemo(() => {
        const userHtml = to_display || '';

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body>
    <script>
        // Bridge function for form data - stores to COR.workspace via postMessage
        function store_in_workspace(data) {
            if (!data || typeof data !== 'object') {
                console.error('store_in_workspace: data must be an object');
                return;
            }

            window.parent.postMessage({
                type: 'html_widget_data',
                payload: data,
                timestamp: Date.now()
            }, '*');

            console.log('Data sent to workspace:', data);
        }

        // Bridge function to signal completion and trigger LLM invocation
        function complete_html_interaction(message) {
            const userMessage = message || "I'm done interacting with the HTML form";

            window.parent.postMessage({
                type: 'html_interaction_complete',
                message: userMessage,
                timestamp: Date.now()
            }, '*');

            console.log('HTML interaction complete, triggering LLM with message:', userMessage);
        }

        // Make bridge functions globally available
        window.store_in_workspace = store_in_workspace;
        window.complete_html_interaction = complete_html_interaction;
    </script>
    ${userHtml}
</body>
</html>`;
    }, [to_display]);

    useEffect(() => {
        log(`HTML widget updated with sandboxed iframe`);
    }, [to_display])

    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-[18px]">
            <iframe
                sandbox="allow-scripts allow-forms"
                srcDoc={srcdoc}
                style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    flexGrow: 1
                }}
                title="HTML Widget Content"
            />
        </div>
    );
};

export default HTMLWidget;
