import { useState, type ReactElement } from 'react';
import { MenuScreen } from './components/MenuScreen';
import { AboutScreen } from './components/AboutScreen';
import { BotTokenStep } from './components/BotTokenStep';
import { ProviderStep } from './components/ProviderStep';
import { DeployStatusView } from './components/DeployStatusView';
import { hapticImpact } from './telegram';

type Screen = 'menu' | 'about' | 'step1' | 'step2' | 'status';

export function App(): ReactElement {
  const [screen, setScreen] = useState<Screen>('menu');
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);

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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[400px] flex-col bg-bg px-[18px] py-6 font-pixel text-xs leading-[1.9] text-ink">
      {screen === 'menu' && <MenuScreen onCreate={() => go('step1')} onAbout={() => go('about')} />}
      {screen === 'about' && <AboutScreen onBack={() => go('menu')} onCreate={() => go('step1')} />}
      {screen === 'step1' && (
        <BotTokenStep
          botToken={botToken}
          botUsername={botUsername}
          onTokenChange={setBotToken}
          onValidated={setBotUsername}
          onBack={() => go('menu')}
          onNext={() => go('step2')}
        />
      )}
      {screen === 'step2' && (
        <ProviderStep botToken={botToken} onBack={() => go('step1')} onDeployed={handleDeployed} />
      )}
      {screen === 'status' && deployId && (
        <DeployStatusView deployId={deployId} onReset={handleReset} />
      )}
    </main>
  );
}
