import { useState, type ReactElement } from 'react';
import { MenuScreen } from './components/MenuScreen';
import { AboutScreen } from './components/AboutScreen';
import { BotTokenStep } from './components/BotTokenStep';
import { PaymentStep } from './components/PaymentStep';
import { DeployStatusView } from './components/DeployStatusView';
import { AgentsListScreen } from './components/AgentsListScreen';
import { AgentDetailScreen } from './components/AgentDetailScreen';
import { hapticImpact } from './telegram';

type Screen = 'menu' | 'about' | 'step1' | 'pay' | 'status' | 'agents' | 'agent';

export function App(): ReactElement {
  const [screen, setScreen] = useState<Screen>('menu');
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);
  const [selectedDeployId, setSelectedDeployId] = useState<string | null>(null);

  function go(next: Screen): void {
    hapticImpact('light');
    setScreen(next);
  }

  function handleDeployed(id: string): void {
    setDeployId(id);
    go('status');
  }

  function handleReset(): void {
    setBotToken('');
    setBotUsername(null);
    setDeployId(null);
    go('menu');
  }

  function openAgent(id: string): void {
    setSelectedDeployId(id);
    go('agent');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[400px] flex-col bg-bg px-[18px] py-6 font-pixel text-xs leading-[1.9] text-ink">
      {screen === 'menu' && (
        <MenuScreen
          onCreate={() => go('step1')}
          onAgents={() => go('agents')}
          onAbout={() => go('about')}
        />
      )}
      {screen === 'about' && <AboutScreen onBack={() => go('menu')} onCreate={() => go('step1')} />}
      {screen === 'step1' && (
        <BotTokenStep
          botToken={botToken}
          botUsername={botUsername}
          onTokenChange={setBotToken}
          onValidated={setBotUsername}
          onBack={() => go('menu')}
          onNext={() => go('pay')}
        />
      )}
      {screen === 'pay' && (
        <PaymentStep botToken={botToken} onBack={() => go('step1')} onDeployed={handleDeployed} />
      )}
      {screen === 'status' && deployId && (
        <DeployStatusView deployId={deployId} onReset={handleReset} />
      )}
      {screen === 'agents' && (
        <AgentsListScreen
          onOpen={openAgent}
          onCreate={() => go('step1')}
          onBack={() => go('menu')}
        />
      )}
      {screen === 'agent' && selectedDeployId && (
        <AgentDetailScreen
          deployId={selectedDeployId}
          onBack={() => go('agents')}
          onDeleted={() => go('agents')}
        />
      )}
    </main>
  );
}
