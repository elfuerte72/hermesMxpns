jest.mock('hostinger-api-sdk');
jest.mock('axios', () => ({ __esModule: true, default: { delete: jest.fn() } }));

import axios from 'axios';
import {
  BillingCatalogApi,
  Configuration,
  VPSActionsApi,
  VPSDataCentersApi,
  VPSOSTemplatesApi,
  VPSPostInstallScriptsApi,
  VPSVirtualMachineApi,
} from 'hostinger-api-sdk';
import { ProvisioningService } from './provisioning.service';

const TOKEN = 'test-operator-token';

function asMock(cls: unknown): jest.Mock {
  return cls as unknown as jest.Mock;
}

describe('ProvisioningService', () => {
  let svc: ProvisioningService;

  const api = {
    getCatalogItemListV1: jest.fn(),
    getDataCenterListV1: jest.fn(),
    getTemplatesV1: jest.fn(),
    createPostInstallScriptV1: jest.fn(),
    deletePostInstallScriptV1: jest.fn(),
    purchaseNewVirtualMachineV1: jest.fn(),
    getVirtualMachineDetailsV1: jest.fn(),
    getVirtualMachinesV1: jest.fn(),
    getActionsV1: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    asMock(BillingCatalogApi).mockImplementation(() => ({
      getCatalogItemListV1: api.getCatalogItemListV1,
    }));
    asMock(VPSDataCentersApi).mockImplementation(() => ({
      getDataCenterListV1: api.getDataCenterListV1,
    }));
    asMock(VPSOSTemplatesApi).mockImplementation(() => ({ getTemplatesV1: api.getTemplatesV1 }));
    asMock(VPSPostInstallScriptsApi).mockImplementation(() => ({
      createPostInstallScriptV1: api.createPostInstallScriptV1,
      deletePostInstallScriptV1: api.deletePostInstallScriptV1,
    }));
    asMock(VPSVirtualMachineApi).mockImplementation(() => ({
      purchaseNewVirtualMachineV1: api.purchaseNewVirtualMachineV1,
      getVirtualMachineDetailsV1: api.getVirtualMachineDetailsV1,
      getVirtualMachinesV1: api.getVirtualMachinesV1,
    }));
    asMock(VPSActionsApi).mockImplementation(() => ({ getActionsV1: api.getActionsV1 }));
    asMock(Configuration).mockImplementation(() => ({}));
    (axios.delete as unknown as jest.Mock).mockResolvedValue({ status: 204 });

    svc = new ProvisioningService(TOKEN);
  });

  it('getCatalog maps catalog items and filters VPS category', async () => {
    api.getCatalogItemListV1.mockResolvedValue({
      data: [
        {
          id: 'hostingercom-vps-kvm1',
          name: 'KVM 1',
          category: 'VPS',
          prices: [
            {
              id: 'hostingercom-vps-kvm1-usd-1m',
              name: '1 Month',
              currency: 'USD',
              price: 999,
              first_period_price: 999,
              period: 1,
              period_unit: 'month',
            },
          ],
        },
      ],
    });

    const result = await svc.getCatalog();

    expect(api.getCatalogItemListV1).toHaveBeenCalledWith('VPS');
    expect(result[0].id).toBe('hostingercom-vps-kvm1');
    expect(result[0].prices[0].id).toBe('hostingercom-vps-kvm1-usd-1m');
  });

  it('listDataCenters maps data centers', async () => {
    api.getDataCenterListV1.mockResolvedValue({
      data: [{ id: 11, name: 'Vilnius', location: 'LT', city: 'Vilnius', continent: 'EU' }],
    });

    const result = await svc.listDataCenters();

    expect(result[0]).toEqual({ id: 11, name: 'Vilnius', location: 'LT', city: 'Vilnius' });
  });

  it('listTemplates maps templates', async () => {
    api.getTemplatesV1.mockResolvedValue({
      data: [
        { id: 1121, name: 'Ubuntu 24.04 with Docker', description: 'docker', documentation: null },
      ],
    });

    const result = await svc.listTemplates();

    expect(result[0]).toEqual({
      id: 1121,
      name: 'Ubuntu 24.04 with Docker',
      description: 'docker',
    });
  });

  it('createPostInstallScript passes name+content and returns the script id', async () => {
    api.createPostInstallScriptV1.mockResolvedValue({
      data: {
        id: 6324,
        name: 'hermes-bootstrap',
        content: '#!/bin/bash',
        created_at: 'x',
        updated_at: 'x',
      },
    });

    const result = await svc.createPostInstallScript('hermes-bootstrap', '#!/bin/bash');

    expect(api.createPostInstallScriptV1).toHaveBeenCalledWith({
      name: 'hermes-bootstrap',
      content: '#!/bin/bash',
    });
    expect(result.id).toBe(6324);
  });

  it('deletePostInstallScript calls SDK with the id', async () => {
    api.deletePostInstallScriptV1.mockResolvedValue({ data: {} });
    await svc.deletePostInstallScript(6324);
    expect(api.deletePostInstallScriptV1).toHaveBeenCalledWith(6324);
  });

  it('purchaseVM builds the purchase request and returns the created VM', async () => {
    api.purchaseNewVirtualMachineV1.mockResolvedValue({
      data: {
        order: { id: 99 },
        virtual_machine: {
          id: 123,
          hostname: 'hermes-1',
          state: 'creating',
          ipv4: [],
          subscription_id: null,
          data_center_id: 11,
          plan: 'kvm1',
          created_at: '2026-07-04T00:00:00Z',
        },
      },
    });

    const result = await svc.purchaseVM({
      itemId: 'hostingercom-vps-kvm1-usd-1m',
      setup: { templateId: 1121, dataCenterId: 11, postInstallScriptId: 6324 },
    });

    expect(api.purchaseNewVirtualMachineV1).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: 'hostingercom-vps-kvm1-usd-1m',
        setup: expect.objectContaining({
          template_id: 1121,
          data_center_id: 11,
          post_install_script_id: 6324,
        }),
      }),
    );
    expect(result.orderId).toBe(99);
    expect(result.virtualMachine.id).toBe(123);
    expect(result.virtualMachine.state).toBe('creating');
  });

  it('getVM maps a virtual machine including ipv4 addresses', async () => {
    api.getVirtualMachineDetailsV1.mockResolvedValue({
      data: {
        id: 123,
        hostname: 'hermes-1',
        state: 'running',
        ipv4: [{ id: 1, address: '1.2.3.4', ptr: null }],
        subscription_id: 'sub-1',
        data_center_id: 11,
        plan: 'kvm1',
        created_at: '2026-07-04T00:00:00Z',
      },
    });

    const result = await svc.getVM(123);

    expect(api.getVirtualMachineDetailsV1).toHaveBeenCalledWith(123);
    expect(result.ipv4).toEqual(['1.2.3.4']);
    expect(result.state).toBe('running');
  });

  it('listVMs maps a list of virtual machines', async () => {
    api.getVirtualMachinesV1.mockResolvedValue({
      data: [
        {
          id: 1,
          hostname: 'a',
          state: 'running',
          ipv4: [],
          subscription_id: null,
          data_center_id: null,
          plan: null,
          created_at: 'x',
        },
      ],
    });

    const result = await svc.listVMs();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('listActions unwraps the paginated actions data', async () => {
    api.getActionsV1.mockResolvedValue({
      data: {
        data: [{ id: 7, name: 'install', state: 'success', created_at: 'x', updated_at: 'x' }],
        meta: {},
      },
    });

    const result = await svc.listActions(123);

    expect(api.getActionsV1).toHaveBeenCalledWith(123);
    expect(result[0]).toEqual({
      id: 7,
      name: 'install',
      state: 'success',
      created_at: 'x',
      updated_at: 'x',
    });
  });

  it('deleteVM calls DELETE on the documented endpoint with the bearer token (SDK gap)', async () => {
    await svc.deleteVM(123);
    expect(axios.delete).toHaveBeenCalledWith(
      'https://developers.hostinger.com/api/vps/v1/virtual-machines/123',
      {
        headers: { Authorization: 'Bearer test-operator-token' },
      },
    );
  });
});
