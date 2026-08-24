import React, { useEffect, useRef } from 'react';
import './GodotContainer.css';

declare global {
  interface Window {
    Engine: any;
    API_BASE_URL: string; // 声明全局变量，供 Godot 的 JavaScriptBridge 读取
  }
}

export const GodotContainer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLProgressElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. 动态注入后端 API 基础路径
    // 生产/同域部署时：window.location.origin (例如 https://your-domain.com)
    // 本地开发时如果前后端分离，也可以写死为 "http://localhost:8080"
    window.API_BASE_URL = window.location.origin;

    const scriptId = 'godot-engine-js';

    const loadGodotScript = () => {
      if (document.getElementById(scriptId)) {
        initGodot();
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = '/Godot/index.js'; // 对应 public/Godot/index.js
      script.onload = initGodot;
      document.body.appendChild(script);
    };

    const initGodot = async () => {
      if (!window.Engine || !canvasRef.current) return;

      const GODOT_CONFIG = {
        args: [],
        canvasResizePolicy: 2,
        emscriptenPoolSize: 8,
        ensureCrossOriginIsolationHeaders: true,
        executable: '/Godot/index',
        experimentalVK: false,
        fileSizes: {
          'index.pck': 2760912,
          'index.wasm': 37900721,
        },
        focusCanvas: true,
        gdextensionLibs: [],
        godotPoolSize: 4,
      };

      const GODOT_THREADS_ENABLED = false;
      const engine = new window.Engine(GODOT_CONFIG);

      const statusOverlay = statusRef.current;
      const statusProgress = progressRef.current;
      const statusNotice = noticeRef.current;

      let initializing = true;
      let statusMode = '';

      const setStatusMode = (mode: string) => {
        if (statusMode === mode || !initializing || !statusOverlay) return;
        if (mode === 'hidden') {
          statusOverlay.style.display = 'none';
          initializing = false;
          return;
        }
        statusOverlay.style.visibility = 'visible';
        if (statusProgress) statusProgress.style.display = mode === 'progress' ? 'block' : 'none';
        if (statusNotice) statusNotice.style.display = mode === 'notice' ? 'block' : 'none';
        statusMode = mode;
      };

      const setStatusNotice = (text: string) => {
        if (!statusNotice) return;
        while (statusNotice.lastChild) {
          statusNotice.removeChild(statusNotice.lastChild);
        }
        text.split('\n').forEach((line) => {
          statusNotice.appendChild(document.createTextNode(line));
          statusNotice.appendChild(document.createElement('br'));
        });
      };

      const displayFailureNotice = (err: any) => {
        console.error(err);
        if (err instanceof Error) {
          setStatusNotice(err.message);
        } else if (typeof err === 'string') {
          setStatusNotice(err);
        } else {
          setStatusNotice('An unknown error occurred.');
        }
        setStatusMode('notice');
        initializing = false;
      };

      const missing = window.Engine.getMissingFeatures({
        threads: GODOT_THREADS_ENABLED,
      });

      if (missing.length !== 0) {
        const missingMsg = 'Error\nThe following features required to run Godot projects on the Web are missing:\n';
        displayFailureNotice(missingMsg + missing.join('\n'));
      } else {
        setStatusMode('progress');
        try {
          await engine.startGame({
            canvas: canvasRef.current,
            onProgress: (current: number, total: number) => {
              if (current > 0 && total > 0 && statusProgress) {
                statusProgress.value = current;
                statusProgress.max = total;
              } else if (statusProgress) {
                statusProgress.removeAttribute('value');
                statusProgress.removeAttribute('max');
              }
            },
          });
          setStatusMode('hidden');
        } catch (err) {
          displayFailureNotice(err);
        }
      }
    };

    loadGodotScript();
  }, []);

  return (
    <div className="godot-container">
      <canvas ref={canvasRef} id="canvas" tabIndex={0}>
        Your browser does not support the canvas tag.
      </canvas>

      <div ref={statusRef} id="status">
        <img
          id="status-splash"
          className="show-image--true fullsize--true use-filter--true"
          src="/Godot/index.png"
          alt=""
        />
        <progress ref={progressRef} id="status-progress"></progress>
        <div ref={noticeRef} id="status-notice"></div>
      </div>
    </div>
  );
};