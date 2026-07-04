import { useState, type ReactElement } from 'react';
import { DeployForm } from './components/DeployForm';
import { DeployStatusView } from './components/DeployStatusView';

export function App(): ReactElement {
  const [deployId, setDeployId] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-4">
      {deployId ? (
        <DeployStatusView deployId={deployId} onReset={() => setDeployId(null)} />
      ) : (
        <DeployForm onDeployed={setDeployId} />
      )}
    </main>
  );
}
