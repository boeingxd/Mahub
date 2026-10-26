import { errorText, type ApiState } from '../api';
import { AlertIcon } from './icons';
import { Button, ButtonRoute } from './Button';
import type { ReactNode } from 'react';

// What a screen shows while its data is loading or when it failed. Returns
// nothing once the data is there, so a page can do:
//   if (state.status !== 'done') return <ApiStatus state={state} retry={retry} />;
export function ApiStatus({ state, retry }: { state: ApiState<unknown>; retry: () => void }) {
  if (state.status === 'done') return null;
  if (state.status === 'loading') {
    return (
      <p className="empty" role="status">
        Loading…
      </p>
    );
  }
  return (
    <ErrorBox code={state.code}>
      {state.code === 'UNAUTHENTICATED' ? (
        <ButtonRoute to="/" className="api-status-action">
          Sign in
        </ButtonRoute>
      ) : (
        <Button onClick={retry} className="api-status-action">
          Try again
        </Button>
      )}
    </ErrorBox>
  );
}

// The red box: what went wrong, in words, for one error code. Optional buttons below.
export function ErrorBox({ code, children }: { code: string; children?: ReactNode }) {
  const text = errorText[code] ?? errorText.INTERNAL;
  return (
    <div className="inline-alert api-status" role="alert">
      <AlertIcon className="inline-alert-icon" />
      <div>
        <p className="inline-alert-title">{text.title}</p>
        <p className="inline-alert-text">{text.message}</p>
        {children}
      </div>
    </div>
  );
}
