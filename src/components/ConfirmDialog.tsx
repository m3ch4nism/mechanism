import { useState, useCallback, createContext, useContext } from "react";

type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
} | null;

const ConfirmContext = createContext<(msg: string) => Promise<boolean>>(() => Promise.resolve(false));

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ message, resolve });
    });
  }, []);

  const handleOk = () => { state?.resolve(true); setState(null); };
  const handleCancel = () => { state?.resolve(false); setState(null); };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-message">{state.message}</div>
            <div className="confirm-actions">
              <button className="btn danger" onClick={handleOk}>Delete</button>
              <button className="btn" onClick={handleCancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
