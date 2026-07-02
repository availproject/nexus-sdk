import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { WalletConnectModal } from "./WalletConnectModal";

type WalletModalContext = {
  open: () => void;
  close: () => void;
};

const Ctx = createContext<WalletModalContext | null>(null);

export function useWalletModal(): WalletModalContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useWalletModal must be used within <WalletProvider>");
  }
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletConnectModal open={isOpen} onOpenChange={setIsOpen} />
    </Ctx.Provider>
  );
}
