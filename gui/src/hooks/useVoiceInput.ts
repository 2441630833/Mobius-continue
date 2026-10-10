import { Editor } from "@tiptap/core";
import { InputModifiers } from "core";
import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API interface definitions
interface ISpeechRecognitionResult {
  readonly length: number;
  [index: number]: {
    transcript: string;
    confidence: number;
  };
  isFinal: boolean;
}

interface ISpeechRecognitionResultList {
  readonly length: number;
  [index: number]: ISpeechRecognitionResult;
}

interface ISpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ISpeechRecognitionResultList;
}

interface ISpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => any) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => any) | null;
  onaudiostart: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onaudioend: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onspeechstart: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onspeechend: ((this: ISpeechRecognition, ev: Event) => any) | null;
}

interface SpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

export interface UseVoiceInputOptions {
  editor: Editor | null;
  onEnter?: (modifiers: InputModifiers) => void;
  isStreaming?: boolean;
  silenceTimeoutMs?: number;
}

export interface UseVoiceInputReturn {
  isListening: boolean;
  isSpeaking: boolean;
  isSupported: boolean;
  isWaitingForStream: boolean;
  transcriptPreview: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  toggleVoiceInput: () => void;
}

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function useVoiceInput({
  editor,
  onEnter,
  isStreaming = false,
  silenceTimeoutMs = 1200,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isWaitingForStream, setIsWaitingForStream] = useState(false);
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [error, setError] = useState<string | null>(null);

  const SpeechRecognitionClass = getSpeechRecognitionClass();
  const isSupported = !!SpeechRecognitionClass;

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const isActiveRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(isStreaming);
  isStreamingRef.current = isStreaming;

  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  const onEnterRef = useRef<((modifiers: InputModifiers) => void) | undefined>(onEnter);
  onEnterRef.current = onEnter;

  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentUtteranceRef = useRef<string>("");
  const hasSpokenContentRef = useRef<boolean>(false);

  // Clear silence timer
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Clear restart timer
  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  // Trigger send of recognized text
  const submitSpokenText = useCallback(() => {
    clearSilenceTimer();

    const currentText = currentUtteranceRef.current.trim();
    if (!currentText && (!editorRef.current || editorRef.current.isEmpty)) {
      hasSpokenContentRef.current = false;
      return;
    }

    if (isStreamingRef.current) {
      // If streaming, wait for stream to finish before submitting
      setIsWaitingForStream(true);
      return;
    }

    // Submit text to chat
    if (onEnterRef.current) {
      onEnterRef.current({
        useCodebase: false,
        noContext: false,
      });
    }

    // Reset current utterance buffer for next continuous speech turn
    currentUtteranceRef.current = "";
    hasSpokenContentRef.current = false;
    setTranscriptPreview("");
    setIsWaitingForStream(false);
  }, [clearSilenceTimer]);

  // When streaming finishes, if we were waiting to submit, submit immediately
  useEffect(() => {
    if (!isStreaming && isWaitingForStream && hasSpokenContentRef.current) {
      setIsWaitingForStream(false);
      submitSpokenText();
    }
  }, [isStreaming, isWaitingForStream, submitSpokenText]);

  // Stop listening explicitly
  const stopListening = useCallback(() => {
    isActiveRef.current = false;
    clearSilenceTimer();
    clearRestartTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop error
      }
      recognitionRef.current = null;
    }

    setIsListening(false);
    setIsSpeaking(false);
    setIsWaitingForStream(false);
    currentUtteranceRef.current = "";
    hasSpokenContentRef.current = false;
    setTranscriptPreview("");
  }, [clearSilenceTimer, clearRestartTimer]);

  // Start speech recognition instance
  const startRecognitionInstance = useCallback(() => {
    if (!SpeechRecognitionClass || !isActiveRef.current) {
      return;
    }

    // Clean up previous instance if any
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore abort error
      }
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang =
        (typeof navigator !== "undefined" && navigator.language) || "zh-CN";

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onaudiostart = () => {
        setIsSpeaking(true);
      };

      recognition.onspeechstart = () => {
        setIsSpeaking(true);
      };

      recognition.onspeechend = () => {
        setIsSpeaking(false);
      };

      recognition.onaudioend = () => {
        setIsSpeaking(false);
      };

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        clearSilenceTimer();

        let finalPart = "";
        let interimPart = "";

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript || "";
          if (result.isFinal) {
            finalPart += transcript;
          } else {
            interimPart += transcript;
          }
        }

        const fullUtterance = (finalPart + interimPart).trim();
        if (fullUtterance) {
          hasSpokenContentRef.current = true;
          currentUtteranceRef.current = fullUtterance;
          setTranscriptPreview(fullUtterance);

          // Update editor content in real time
          if (editorRef.current) {
            editorRef.current.commands.setContent(fullUtterance);
          }

          // Reset silence debounce timer: auto-send after user stops speaking
          silenceTimerRef.current = setTimeout(() => {
            submitSpokenText();
          }, silenceTimeoutMs);
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        // "no-speech" is common during pauses in continuous mode; do not terminate
        if (event.error === "no-speech") {
          return;
        }

        // "aborted" is triggered on manual stop / restart
        if (event.error === "aborted") {
          return;
        }

        if (event.error === "not-allowed") {
          setError("麦克风权限未开启，请在系统设置中允许访问麦克风。");
          stopListening();
          return;
        }

        if (event.error === "audio-capture") {
          setError("未检测到麦克风音频输入设备。");
          stopListening();
          return;
        }

        if (event.error === "network") {
          setError("语音识别网络连接异常。");
          return;
        }

        console.warn("Speech recognition error:", event.error);
      };

      recognition.onend = () => {
        setIsSpeaking(false);

        // Continuous mode requirement:
        // If voice mode is still active, automatically restart recognition so the user can continue speaking indefinitely
        if (isActiveRef.current) {
          clearRestartTimer();
          restartTimerRef.current = setTimeout(() => {
            if (isActiveRef.current) {
              startRecognitionInstance();
            }
          }, 200);
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn("Failed to start SpeechRecognition:", err);
      setError("启动语音识别失败: " + (err?.message || "未知错误"));
      setIsListening(false);
    }
  }, [
    SpeechRecognitionClass,
    clearSilenceTimer,
    clearRestartTimer,
    silenceTimeoutMs,
    stopListening,
    submitSpokenText,
  ]);

  // Start listening explicitly
  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("当前环境不支持 Web Speech API 语音识别。");
      return;
    }

    setError(null);
    isActiveRef.current = true;
    currentUtteranceRef.current = "";
    hasSpokenContentRef.current = false;
    setTranscriptPreview("");
    setIsWaitingForStream(false);

    startRecognitionInstance();
  }, [isSupported, startRecognitionInstance]);

  // Toggle voice input
  const toggleVoiceInput = useCallback(() => {
    if (isListening || isActiveRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      clearSilenceTimer();
      clearRestartTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort error
        }
        recognitionRef.current = null;
      }
    };
  }, [clearSilenceTimer, clearRestartTimer]);

  return {
    isListening,
    isSpeaking,
    isSupported,
    isWaitingForStream,
    transcriptPreview,
    error,
    startListening,
    stopListening,
    toggleVoiceInput,
  };
}
