// app/client/src/components/chat/ChatWidget.jsx
import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api/api.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  "What vaccines have I received in the past?",
  "When is my next vaccine due?",
  "What vaccines am I eligible for?",
];

// ✅ define a real disclaimer (you were referencing an undefined variable before)
const DISCLAIMER_TEXT =
  "This assistant is for informational purposes only and does not replace medical advice.";

export default function ChatWidget({ profileId = "p1", profile, eligibility }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi! I'm your assistant. Ask me about your vaccine schedules or history.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const endRef = useRef(null);

  const scrollToBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  async function send(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || loading) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await api.chat(profileId, trimmed, { profile, eligibility });
      const answerText = res?.answer ?? res ?? "I couldn't generate a response.";

      setMessages((m) => [...m, { role: "assistant", text: String(answerText) }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "⚠️ Connection error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      {/* Suggestions Section */}
      <div style={styles.suggestions}>
        {SUGGESTIONS.map((s) => (
          <button key={s} style={styles.chip} onClick={() => send(s)} disabled={loading}>
            {s}
          </button>
        ))}
      </div>

      {/* Chat History */}
      <div style={styles.chatBox}>
        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          return (
            <div
              key={idx}
              style={{
                ...styles.messageWrapper,
                flexDirection: isUser ? "row-reverse" : "row",
              }}
            >
              {!isUser && <div style={styles.avatar}>Q</div>}
              <div
                style={{
                  ...styles.bubble,
                  backgroundColor: isUser ? "#007AFF" : "#E9E9EB",
                  color: isUser ? "#fff" : "#000",
                  borderRadius: isUser ? "18px 18px 2px 18px" : "18px 18px 18px 2px",
                }}
              >
                <div style={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div style={styles.loadingContainer}>
            <div style={styles.avatar}>Q</div>
            <div style={styles.typingIndicator}>•••</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input Area */}
      <div style={styles.inputArea}>
        <textarea
          style={styles.textarea}
          placeholder="Ask Assistant..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={loading}
          rows={1}
        />
        <button
          style={{
            ...styles.sendButton,
            backgroundColor: !input.trim() || loading ? "#ccc" : "#007AFF",
          }}
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
        >
          Send
        </button>
      </div>

      {/* ✅ disclaimer fixed */}
      <div style={styles.disclaimer}>{DISCLAIMER_TEXT}</div>
    </div>
  );
}

const styles = {
  card: {
    background: "#e8ebee",
    border: "1px solid #eee",
    borderRadius: 14,
    padding: 14,
    // ✅ FIX: keep only ONE boxShadow
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    display: "flex",
    flexDirection: "column",
    height: "500px",
    width: "100%",
    maxWidth: "450px",
    overflow: "hidden",
  },
  suggestions: {
    padding: "12px",
    display: "flex",
    gap: "8px",
    overflowX: "auto",
    borderBottom: "1px solid #f0f0f0",
    scrollbarWidth: "none", // Hide scrollbar (Firefox)
  },
  chip: {
    whiteSpace: "nowrap",
    padding: "6px 14px",
    borderRadius: "100px",
    border: "1px solid #007AFF",
    background: "transparent",
    color: "#007AFF",
    fontSize: "12px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  chatBox: {
    flex: 1,
    padding: "16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    backgroundColor: "#fff",
  },
  messageWrapper: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    marginBottom: "4px",
  },
  avatar: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    backgroundColor: "#007AFF",
    color: "#fff",
    fontSize: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    flexShrink: 0,
  },
  bubble: {
    padding: "10px 16px",
    maxWidth: "75%",
    fontSize: "14px",
    lineHeight: "1.5",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  typingIndicator: {
    background: "#E9E9EB",
    padding: "8px 16px",
    borderRadius: "18px",
    fontSize: "12px",
    color: "#8E8E93",
  },
  inputArea: {
    padding: "16px",
    borderTop: "1px solid #f0f0f0",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },
  textarea: {
    flex: 1,
    border: "1px solid #E9E9EB",
    borderRadius: "20px",
    padding: "10px 16px",
    fontSize: "14px",
    resize: "none",
    outline: "none",
    backgroundColor: "#F2F2F7",
    maxHeight: "100px",
  },
  sendButton: {
    border: "none",
    color: "#fff",
    padding: "8px 16px",
    borderRadius: "20px",
    fontWeight: "600",
    cursor: "pointer",
    fontSize: "14px",
    transition: "background 0.2s",
  },
  disclaimer: {
    fontSize: "10px",
    textAlign: "center",
    color: "#8E8E93",
    padding: "0 16px 12px 16px",
    marginTop: 8,
  },
  markdown: {
    // Inline styles don’t support "& p" like CSS-in-JS frameworks do,
    // but keeping this harmless. If you want real markdown spacing control,
    // use a CSS file or add components prop in ReactMarkdown.
  },
};
