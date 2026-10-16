import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

// 遮罩关闭的三个前提，缺一不可：
//  1) closeOnBackdrop 未被关闭（多步表单会传 false，避免误点丢草稿）；
//  2) 这次按下（mousedown）确实起始于遮罩本身，而不是从弹窗内部拖出来的；
//  3) 弹窗已经打开超过 300ms —— 否则「编辑」按钮位于弹窗右侧遮罩范围时，
//     双击的第二下 mousedown 会在弹窗刚打开的瞬间把它关掉（曾被反馈为“闪退”）。
const MIN_OPEN_MS_BEFORE_BACKDROP_CLOSE = 300;

export default function Modal({ title, subtitle, children, onClose, footer, wide = false, closeOnBackdrop = true }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const backdropPressed = useRef(false);
  const openedAt = useRef(Date.now());
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const firstField = dialog?.querySelector('[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (firstField || dialog)?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus?.(); };
  }, []);
  const onBackdropMouseDown = (event) => { backdropPressed.current = event.target === event.currentTarget; };
  const onBackdropClick = (event) => {
    const startedOnBackdrop = backdropPressed.current;
    backdropPressed.current = false;
    if (!closeOnBackdrop || !startedOnBackdrop || event.target !== event.currentTarget) return;
    if (Date.now() - openedAt.current < MIN_OPEN_MS_BEFORE_BACKDROP_CLOSE) return;
    onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}
