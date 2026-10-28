'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ActionButton } from './button';

export type DialogProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  description?: ReactNode;
  dirty?: boolean;
  danger?: boolean;
  size?: 'small' | 'medium' | 'large' | 'fullscreen';
  placement?: 'center' | 'right';
};

/** Accessible dialog foundation shared by centered modals and right-hand slide-overs. */
export function Dialog({
  title,
  open,
  onClose,
  children,
  footer,
  description,
  dirty = false,
  danger = false,
  size = 'medium',
  placement = 'center',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const initial = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const current = useRef({ onClose, dirty });
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    current.current = { onClose, dirty };
  }, [onClose, dirty]);

  const requestClose = () => {
    if (current.current.dirty) setDiscardOpen(true);
    else current.current.onClose();
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => initial.current?.focus(), 0);
    function onKey(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (holder.current !== dialogs[dialogs.length - 1]) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (current.current.dirty) setDiscardOpen(true);
        else current.current.onClose();
      }
      if (event.key === 'Tab') {
        const elements = holder.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return (
    <>
      {createPortal(
        <div
          className={`ui-modal-backdrop ${placement === 'right' ? 'ui-modal-backdrop--right' : ''}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !discardOpen) requestClose();
          }}
        >
          <div
            ref={holder}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            className={`ui-modal ui-modal--${size} ${placement === 'right' ? 'ui-modal--right' : ''}`}
          >
            <header className="ui-modal-header">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="font-semibold">
                  {title}
                </h2>
                {description && (
                  <div id={descriptionId} className="ui-modal-description">
                    {description}
                  </div>
                )}
              </div>
              <button
                ref={initial}
                type="button"
                className="ui-button ui-button--outline ui-button--small"
                onClick={requestClose}
                aria-label={`Close ${title}`}
                title={`Close ${title}`}
              >
                <X size={16} />
              </button>
            </header>
            <div className="ui-modal-body">{children}</div>
            {footer && (
              <footer className={`ui-modal-footer ${danger ? 'ui-modal-footer--danger' : ''}`}>
                {footer}
              </footer>
            )}
          </div>
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        description="Your unsaved changes will be lost."
        confirmLabel="Discard changes"
        danger
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          current.current.onClose();
        }}
      />
    </>
  );
}

/** The slide-over reuses Dialog focus, Escape, backdrop, stacking and scroll locking. */
export function SlideOver(props: Omit<DialogProps, 'placement' | 'size'>) {
  return <Dialog {...props} placement="right" size="large" />;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  busy = false,
  danger = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Dialog
      title={title}
      open={open}
      onClose={onClose}
      danger={danger}
      size="small"
      footer={
        <>
          <ActionButton onClick={onClose} disabled={busy}>
            Cancel
          </ActionButton>
          <ActionButton variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </ActionButton>
        </>
      }
    >
      <p className="text-sm leading-6">{description}</p>
    </Dialog>
  );
}
