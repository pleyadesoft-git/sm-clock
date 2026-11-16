import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginView } from './components/features/auth/LoginView';
import { Navbar } from './components/layout/Navbar';
import { RelojesView } from './components/features/relojes/RelojesView';
import { MonitorView } from './components/features/monitor/MonitorView';
import { LogsView } from './components/features/diagnostico/LogsView';
import { agentApi } from './lib/agent-api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const DesktopApp: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<'relojes' | 'monitor' | 'logs'>('relojes');
  const [errorCount, setErrorCount] = useState<number>(0);

  // Consultar periódicamente número de errores para el badge de logs
  useEffect(() => {
    async function checkErrorCount() {
      try {
        const res = await agentApi.getLogs('ERROR', undefined, 10);
        setErrorCount(res.counts.errors);
      } catch {
        // Ignorar
      }
    }
    checkErrorCount();
    const interval = setInterval(checkErrorCount, 8000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[var(--bg)] space-y-3">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        <span className="text-xs text-[var(--text-2)] font-medium">Iniciando SM-Clock Agente...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        errorCount={errorCount}
      />

      <main className="flex-1 p-4 max-w-7xl w-full mx-auto overflow-y-auto">
        {currentTab === 'relojes' && <RelojesView />}
        {currentTab === 'monitor' && <MonitorView />}
        {currentTab === 'logs' && <LogsView />}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DesktopApp />
      </AuthProvider>
    </QueryClientProvider>
  );
};
