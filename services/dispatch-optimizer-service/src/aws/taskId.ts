import os from "node:os";

/**
 * Short identifier for this running copy of the service. On ECS it is the
 * task ID from the task metadata endpoint; anywhere else it is the hostname.
 */
export async function resolveTaskId(): Promise<string> {
  const uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (uri) {
    try {
      const res = await fetch(`${uri}/task`);
      const body = (await res.json()) as { TaskARN?: string };
      const id = body.TaskARN?.split("/").pop();
      if (id) return id.slice(0, 12);
    } catch {
      // fall through to hostname
    }
  }
  return os.hostname();
}
