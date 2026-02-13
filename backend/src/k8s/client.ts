import { KubeConfig, CoreV1Api, AppsV1Api, NetworkingV1Api } from "@kubernetes/client-node";

export interface K8sClients {
  core: CoreV1Api;
  apps: AppsV1Api;
  networking: NetworkingV1Api;
}

let cachedClients: K8sClients | null = null;

export function getK8sClients(): K8sClients {
  if (cachedClients) return cachedClients;

  const kc = new KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST) {
    // In-cluster config (when running inside Kubernetes)
    kc.loadFromCluster();
  } else {
    // Local config (~/.kube/config)
    kc.loadFromDefault();
  }

  cachedClients = {
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    networking: kc.makeApiClient(NetworkingV1Api)
  };

  return cachedClients;
}

