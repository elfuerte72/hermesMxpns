export interface HostingerTemplate {
  id: number;
  name: string;
  description: string;
}

export interface HostingerDataCenter {
  id: number;
  name: string;
  location: string | null;
  city: string | null;
}

export interface HostingerCatalogPrice {
  id: string;
  name: string;
  currency: string;
  price: number;
  first_period_price: number;
  period: number;
  period_unit: string;
}

export interface HostingerCatalogItem {
  id: string;
  name: string;
  category: string;
  prices: HostingerCatalogPrice[];
}

export type HostingerVmState =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'stopped'
  | 'creating'
  | 'initial'
  | 'error'
  | 'suspending'
  | 'unsuspending'
  | 'suspended'
  | 'destroying'
  | 'destroyed'
  | 'recreating'
  | 'restoring'
  | 'recovery'
  | 'stopping_recovery';

export interface HostingerVirtualMachine {
  id: number;
  hostname: string;
  state: HostingerVmState;
  ipv4: string[];
  subscription_id: string | null;
  data_center_id: number | null;
  plan: string | null;
  created_at: string;
}

export type HostingerActionState = 'success' | 'error' | 'delayed' | 'sent' | 'created';

export interface HostingerAction {
  id: number;
  name: string;
  state: HostingerActionState;
  created_at: string;
  updated_at: string;
}

export interface HostingerPurchaseSetup {
  templateId: number;
  dataCenterId: number;
  hostname?: string;
  password?: string;
  enableBackups?: boolean;
  installMonarx?: boolean;
}

export interface HostingerPurchaseRequest {
  itemId: string;
  setup: HostingerPurchaseSetup;
  paymentMethodId?: number;
}

export interface HostingerPurchaseResult {
  orderId: number | string;
  virtualMachine: HostingerVirtualMachine;
}

export type HostingerDockerContainerState =
  'created' | 'running' | 'restarting' | 'exited' | 'paused' | 'dead' | 'stopping';

export type HostingerDockerContainerHealth = 'starting' | 'healthy' | 'unhealthy' | '';

export interface HostingerDockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: HostingerDockerContainerState;
  health: HostingerDockerContainerHealth;
}
