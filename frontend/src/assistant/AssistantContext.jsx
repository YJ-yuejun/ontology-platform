import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { resourceKey } from './selection';

const AssistantContext = createContext(null);
export const useAssistant = () => useContext(AssistantContext);

const WELCOME = {
  role: 'assistant',
  text: '我是本体智能。选中页面上的对象、属性或关系，我可以解释定义、检查口径，或起草修改建议。',
  trace: [],
};

const MAX_ITEMS = 20;
const randomConversationId = () => globalThis.crypto?.randomUUID?.()
  || `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function AssistantProvider({ activeId, active, notify, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [items, setItems] = useState([]);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [returnTo, setReturnTo] = useState('/ontology/model/object-properties');
  const [conversationId, setConversationId] = useState(() => randomConversationId());
  const [thinking, setThinking] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [revision, setRevision] = useState(0);
  const itemsRef = useRef([]);
  const pickedEls = useRef(new Map());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    itemsRef.current = [];
    pickedEls.current.forEach((element) => { element.dataset.aiPicked = 'false'; });
    pickedEls.current.clear();
    setItems([]);
    setMessages([WELCOME]);
    setOpen(false);
    setPicking(false);
    setConversationId(randomConversationId());
    setThinking(false);
    setWebSearch(false);
  }, [activeId]);

  useEffect(() => {
    document.body.classList.toggle('ai-picking', picking);
    return () => document.body.classList.remove('ai-picking');
  }, [picking]);

  const pick = useCallback((item, element) => {
    const key = resourceKey(item);
    const exists = itemsRef.current.some((entry) => entry.key === key);
    if (exists) {
      const next = itemsRef.current.filter((entry) => entry.key !== key);
      itemsRef.current = next;
      setItems(next);
      const stored = pickedEls.current.get(key);
      if (stored) stored.dataset.aiPicked = 'false';
      if (element) element.dataset.aiPicked = 'false';
      pickedEls.current.delete(key);
      return next;
    }
    if (itemsRef.current.length >= MAX_ITEMS) {
      notify?.(`一次最多选择 ${MAX_ITEMS} 项，请先取消部分选择。`);
      return itemsRef.current;
    }
    const next = [...itemsRef.current, { ...item, key }];
    itemsRef.current = next;
    setItems(next);
    if (element) {
      element.dataset.aiPicked = 'true';
      pickedEls.current.set(key, element);
    }
    return next;
  }, [notify]);

  const remove = useCallback((item) => {
    const key = item.key || resourceKey(item);
    const next = itemsRef.current.filter((entry) => entry.key !== key);
    itemsRef.current = next;
    setItems(next);
    const stored = pickedEls.current.get(key);
    if (stored) stored.dataset.aiPicked = 'false';
    pickedEls.current.delete(key);
  }, []);

  const clear = useCallback(() => {
    pickedEls.current.forEach((element) => { element.dataset.aiPicked = 'false'; });
    pickedEls.current.clear();
    itemsRef.current = [];
    setItems([]);
  }, []);

  const startPicking = useCallback(() => { setPicking(true); setOpen(false); }, []);
  const stopPicking = useCallback(() => { setPicking(false); setOpen(true); }, []);
  const togglePicking = useCallback(() => {
    if (picking) { setPicking(false); setOpen(true); } else { setPicking(true); setOpen(false); }
  }, [picking]);

  useEffect(() => {
    if (!picking) return undefined;
    const onDocumentClick = (event) => {
      const element = event.target.closest?.('[data-ai-resource]');
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        pick(JSON.parse(element.getAttribute('data-ai-resource')), element);
      } catch {
        /* 忽略无法解析的资源标记 */
      }
    };
    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
  }, [picking, pick]);

  useEffect(() => {
    if (!picking) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setPicking(false);
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picking]);

  const send = useCallback(async (value) => {
    const text = (value ?? input).trim();
    if (!text || busy) return;
    if (!activeId) { notify?.('请先选择一个本体，再开始提问。'); return; }
    const nextConversationId = conversationId || randomConversationId();
    if (!conversationId) setConversationId(nextConversationId);
    setMessages((old) => [...old, {
      role: 'user', text,
      resources: itemsRef.current.map(({ key, ...rest }) => rest),
      thinking_mode: thinking, web_search: webSearch,
    }]);
    setInput('');
    setBusy(true);
    try {
      const result = await api(`/api/ontologies/${activeId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          confirm_action: false,
          context: {
            mode: 'assistant',
            conversation_id: nextConversationId,
            thinking_mode: thinking,
            web_search: webSearch,
            selection: itemsRef.current.map(({ key, ...rest }) => rest),
            scope: { route: location.pathname, title: document.title, ontology: active?.name },
          },
        }),
      });
      setMessages((old) => [...old, {
        role: 'assistant',
        text: result.answer,
        trace: result.trace || [],
        runMode: result.run_mode,
        proposal: result.action_proposal,
      }]);
      setRevision((value) => value + 1);
    } catch (error) {
      setMessages((old) => [...old, { role: 'assistant', text: `请求失败：${error.message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }, [active, activeId, busy, conversationId, input, location.pathname, notify, thinking, webSearch]);

  const replaceItems = useCallback((nextItems) => {
    pickedEls.current.forEach((element) => { element.dataset.aiPicked = 'false'; });
    pickedEls.current.clear();
    const next = nextItems.map((item) => ({ ...item, key: item.key || resourceKey(item) }));
    itemsRef.current = next;
    setItems(next);
  }, []);

  const newConversation = useCallback(() => {
    setConversationId(randomConversationId());
    setMessages([WELCOME]);
    setInput('');
    setThinking(false);
    setWebSearch(false);
    replaceItems([]);
    setRevision((value) => value + 1);
  }, [replaceItems]);

  const loadConversation = useCallback((conversation) => {
    const nextMessages = (conversation.messages || []).map((message) => message.role === 'assistant'
      ? { ...message, runMode: message.run_mode || message.runMode }
      : message);
    const lastResources = [...nextMessages].reverse()
      .find((message) => message.role === 'user' && message.resources?.length)?.resources || [];
    setConversationId(conversation.id);
    setMessages(nextMessages);
    setInput('');
    setThinking(false);
    setWebSearch(false);
    replaceItems(lastResources);
    setPicking(false);
    setOpen(true);
  }, [replaceItems]);

  const openWith = useCallback((item, prompt = '') => {
    if (!item) return;
    const next = [{ ...item, key: resourceKey(item) }];
    itemsRef.current = next;
    setItems(next);
    setInput(prompt);
    setOpen(true);
    setPicking(false);
  }, []);

  const expand = useCallback(() => {
    setReturnTo(location.pathname);
    setOpen(false);
    setPicking(false);
    navigate('/ontology/ai');
  }, [location.pathname, navigate]);

  const collapse = useCallback(() => {
    setPicking(false);
    const target = returnTo && returnTo !== '/ontology/ai' ? returnTo : '/ontology/overview';
    navigate(target);
  }, [navigate, returnTo]);

  const value = useMemo(() => ({
    activeId, active, open, setOpen, picking, items, messages, input, setInput, busy,
    conversationId, thinking, setThinking, webSearch, setWebSearch, revision,
    startPicking, stopPicking, togglePicking, pick, remove, clear, send, openWith, expand, collapse,
    newConversation, loadConversation, replaceItems,
  }), [active, activeId, busy, clear, collapse, conversationId, expand, input, items, loadConversation, messages, newConversation, open, openWith, pick, picking, remove, replaceItems, revision, send, startPicking, stopPicking, thinking, togglePicking, webSearch]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
