'use client';

import React, { useState, useEffect } from 'react';
import { useDesignPack } from '../core/DesignPackContext';

import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";

import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-rust";
import "ace-builds/src-noconflict/mode-swift";


import "ace-builds/src-noconflict/theme-kuroir";
import "ace-builds/src-noconflict/theme-solarized_dark";
import "ace-builds/src-noconflict/theme-solarized_light";
import "ace-builds/src-noconflict/ext-language_tools";

// useInit is a simple useEffect wrapper
const useInit = ({ init, clean_up }: { init: () => any; clean_up: () => any }) => {
  React.useEffect(() => {
    (async () => { await init(); })();
    return clean_up as any;
  }, []);
};

import { logger, fp, debug } from 'smartchats-common';

const log    = logger.get_logger({id:"code_w"});


const CodeEditor = ({code_params , onChange } : any) => {
    const { pack } = useDesignPack();
    const aceTheme = pack.mode === 'dark' ? 'solarized_dark' : 'solarized_light';

    const [localCode, setLocalCode] = useState(code_params.code);
    const [localMode, setLocalMode] = useState(code_params.mode);

    // Update when code_params changes
    useEffect(() => {
	setLocalCode(code_params.code);
	setLocalMode(code_params.mode);
    }, [code_params.code, code_params.mode]); // Update when code or mode changes

    const handleChange = (value: string) => {
	setLocalCode(value);
	onChange({
		code : value ,
		mode : localMode
	}); // updates parent ref, but doesn't trigger re-renders
    };


    let init = async function() {

        if (typeof window !== 'undefined') {
            Object.assign(window, {
		fp,
		debug
            });
            //log("Code Widget init");
        }
    };

    let clean_up = ()=> {
	//log("code editor unmounted");
    };
    useInit({ init , clean_up });  //my wrapper around useEffect



    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-[18px]">

	    <AceEditor
		mode={code_params.mode}
		theme={aceTheme}
		value={localCode}
		onChange={handleChange}
		name="ace-editor"
		fontSize={16}
		width="100%"
		height="100%"
		showPrintMargin={false}
		editorProps={{ $blockScrolling: true }}
		setOptions={{
		    wrap: true,
		    showLineNumbers: true,
		    tabSize: 2,
		    useWorker: false,
		}}
	    />

	    <style>
		{`
          /* Inline CSS to hide scrollbars but still allow scrolling */
          .ace_editor {
            background: transparent !important;
          }
          .ace_scrollbar {
            width: 0 !important;
            height: 0 !important;
          }
          .ace_scrollbar-inner {
            display: none !important;
          }
		`}
	    </style>
        </div>

    );
};

export default CodeEditor;
