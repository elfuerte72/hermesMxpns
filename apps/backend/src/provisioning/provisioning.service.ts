import { Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  BillingCatalogApi,
  Configuration,
  VPSActionsApi,
  VPSDataCentersApi,
  VPSDockerManagerApi,
  VPSOSTemplatesApi,
  VPSVirtualMachineApi,
} from 'hostinger-api-sdk';
import type {
  BillingV1CatalogCatalogItemResource,
  VPSV1ActionActionResource,
  VPSV1DataCenterDataCenterResource,
  VPSV1DockerManagerContainerResource,
  VPSV1TemplateTemplateResource,
  VPSV1VirtualMachinePurchaseRequest,
  VPSV1VirtualMachineSetupRequest,
  VPSV1VirtualMachineVirtualMachineResource,
} from 'hostinger-api-sdk';
import type {
  HostingerAction,
  HostingerCatalogItem,
  HostingerDataCenter,
  HostingerDockerContainer,
  HostingerPurchaseRequest,
  HostingerPurchaseResult,
  HostingerPurchaseSetup,
  HostingerTemplate,
  HostingerVirtualMachine,
} from '@hermes/shared';

const HOSTINGER_BASE_URL = 'https://developers.hostinger.com';
const VM_PATH = '/api/vps/v1/virtual-machines';

@Injectable()
export class ProvisioningService {
  private readonly catalogApi: BillingCatalogApi;
  private readonly dataCentersApi: VPSDataCentersApi;
  private readonly templatesApi: VPSOSTemplatesApi;
  private readonly vmApi: VPSVirtualMachineApi;
  private readonly actionsApi: VPSActionsApi;
  private readonly dockerApi: VPSDockerManagerApi;
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    const config = new Configuration({ accessToken });
    this.catalogApi = new BillingCatalogApi(config);
    this.dataCentersApi = new VPSDataCentersApi(config);
    this.templatesApi = new VPSOSTemplatesApi(config);
    this.vmApi = new VPSVirtualMachineApi(config);
    this.actionsApi = new VPSActionsApi(config);
    this.dockerApi = new VPSDockerManagerApi(config);
  }

  async getCatalog(): Promise<HostingerCatalogItem[]> {
    const res = await this.catalogApi.getCatalogItemListV1('VPS');
    return res.data.map(mapCatalogItem);
  }

  async listDataCenters(): Promise<HostingerDataCenter[]> {
    const res = await this.dataCentersApi.getDataCenterListV1();
    return res.data.map(mapDataCenter);
  }

  async listTemplates(): Promise<HostingerTemplate[]> {
    const res = await this.templatesApi.getTemplatesV1();
    return res.data.map(mapTemplate);
  }

  async purchaseVM(request: HostingerPurchaseRequest): Promise<HostingerPurchaseResult> {
    const body = {
      item_id: request.itemId,
      payment_method_id: request.paymentMethodId,
      setup: {
        template_id: request.setup.templateId,
        data_center_id: request.setup.dataCenterId,
      },
      coupons: [],
    };
    const res = await this.vmApi.purchaseNewVirtualMachineV1(
      body as unknown as VPSV1VirtualMachinePurchaseRequest,
    );
    return {
      orderId: res.data.order.id,
      virtualMachine: mapVM(res.data.virtual_machine),
    };
  }

  async setupVM(id: number, setup: HostingerPurchaseSetup): Promise<HostingerVirtualMachine> {
    const body = {
      template_id: setup.templateId,
      data_center_id: setup.dataCenterId,
    };
    const res = await this.vmApi.setupPurchasedVirtualMachineV1(
      id,
      body as unknown as VPSV1VirtualMachineSetupRequest,
    );
    return mapVM(res.data);
  }

  async getVM(id: number): Promise<HostingerVirtualMachine> {
    const res = await this.vmApi.getVirtualMachineDetailsV1(id);
    return mapVM(res.data);
  }

  async listVMs(): Promise<HostingerVirtualMachine[]> {
    const res = await this.vmApi.getVirtualMachinesV1();
    return res.data.map(mapVM);
  }

  async listActions(vmId: number): Promise<HostingerAction[]> {
    const res = await this.actionsApi.getActionsV1(vmId);
    return res.data.data.map(mapAction);
  }

  async createDockerProject(
    vmId: number,
    projectName: string,
    composeYaml: string,
    envContent: string,
  ): Promise<void> {
    await this.dockerApi.createNewProjectV1(vmId, {
      project_name: projectName,
      content: composeYaml,
      environment: envContent,
    });
  }

  async getDockerProjectContainers(
    vmId: number,
    projectName: string,
  ): Promise<HostingerDockerContainer[]> {
    const res = await this.dockerApi.getProjectContainersV1(vmId, projectName);
    return res.data.map(mapContainer);
  }

  async restartDockerProject(vmId: number, projectName: string): Promise<void> {
    await this.dockerApi.restartProjectV1(vmId, projectName);
  }

  async updateDockerProject(
    vmId: number,
    projectName: string,
    composeYaml: string,
    envContent: string,
  ): Promise<void> {
    await this.dockerApi.createNewProjectV1(vmId, {
      project_name: projectName,
      content: composeYaml,
      environment: envContent,
    });
  }

  async deleteVM(id: number): Promise<void> {
    await axios.delete(`${HOSTINGER_BASE_URL}${VM_PATH}/${id}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }
}

function mapTemplate(t: VPSV1TemplateTemplateResource): HostingerTemplate {
  return { id: t.id, name: t.name, description: t.description };
}

function mapDataCenter(dc: VPSV1DataCenterDataCenterResource): HostingerDataCenter {
  return { id: dc.id, name: dc.name ?? '', location: dc.location, city: dc.city };
}

function mapCatalogItem(item: BillingV1CatalogCatalogItemResource): HostingerCatalogItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    prices: item.prices.map((p) => ({
      id: p.id,
      name: p.name,
      currency: p.currency,
      price: p.price,
      first_period_price: p.first_period_price,
      period: p.period,
      period_unit: p.period_unit,
    })),
  };
}

function mapVM(vm: VPSV1VirtualMachineVirtualMachineResource): HostingerVirtualMachine {
  return {
    id: vm.id,
    hostname: vm.hostname,
    state: vm.state as HostingerVirtualMachine['state'],
    ipv4: vm.ipv4.map((ip) => ip.address),
    subscription_id: vm.subscription_id,
    data_center_id: vm.data_center_id,
    plan: vm.plan,
    created_at: vm.created_at,
  };
}

function mapAction(a: VPSV1ActionActionResource): HostingerAction {
  return {
    id: a.id,
    name: a.name,
    state: a.state as HostingerAction['state'],
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function mapContainer(c: VPSV1DockerManagerContainerResource): HostingerDockerContainer {
  return {
    id: c.id,
    name: c.name,
    image: c.image,
    status: c.status,
    state: c.state as HostingerDockerContainer['state'],
    health: c.health as HostingerDockerContainer['health'],
  };
}
