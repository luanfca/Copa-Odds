/**
 * Componente de instalação PWA - mostra prompt quando disponível
 */

'use client';

import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;

    if (choiceResult.outcome === 'accepted') {
      console.log('PWA instalada com sucesso');
    } else {
      console.log('Usuário recusou instalação');
    }

    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleClose = () => {
    setShowPrompt(false);
  };

  if (!showPrompt || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-card border border-border rounded-lg shadow-lg p-4 z-50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Download className="w-4 h-4" />
            Instalar Odds ao Vivo
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Adicione ao seu dispositivo para acesso rápido e notificações em tempo real.
          </p>
        </div>
        <button
          onClick={handleClose}
          className="ml-2 p-1 hover:bg-accent rounded-md transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleInstall}
          className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4 mr-2 inline" />
          Instalar
        </button>
        <button
          onClick={handleClose}
          className="px-3 py-2 border border-border rounded-md hover:bg-accent transition-colors text-sm"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
