import type { AppInfo } from '@hermes/shared';

const info: AppInfo = { name: 'hermes-deployer', version: '0.1.0' };

export function App(): React.ReactElement {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-2 bg-slate-50">
      <h1 className="text-2xl font-bold text-slate-900">{info.name}</h1>
      <p className="text-slate-500">v{info.version}</p>
    </main>
  );
}
