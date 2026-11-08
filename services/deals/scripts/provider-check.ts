import { config, required } from "../src/config.js";
import { PhotonClient } from "../src/photon.js";
const client = new PhotonClient(config);
const project = required(config.PHOTON_PROJECT_ID, "PHOTON_PROJECT_ID");
for (const [name, path] of Object.entries({
  operation: `/v1/projects/${project}/platforms/operations/${config.PHOTON_OPERATION_ID}`,
  resources: `/v1/projects/${project}/platforms/resources?type=email_domain`,
  billing: `/v1/projects/${project}/billing`,
  messages: `/v1/projects/${project}/messages?platform=email&pageSize=1`,
  versions: `/v1/projects/${project}/webhooks/api-versions`,
  destinations: `/v1/projects/${project}/webhooks/destinations`,
})) {
  try {
    const data = await client.request(path);
    // Output allowlist: operation details can include signed setup URLs. Never log the full response.
    if (name === "operation")
      console.log(
        JSON.stringify({
          check: name,
          state: data.operation?.state,
          verification: data.operation?.detail?.verification,
          checkedAt: new Date().toISOString(),
        }),
      );
    else if (name === "versions")
      console.log(JSON.stringify({ check: name, accessible: true }));
    else
      console.log(
        JSON.stringify({
          check: name,
          accessible: true,
          itemCount:
            (data.items ?? data.resources ?? data.destinations)?.length ?? null,
        }),
      );
  } catch (error) {
    console.log(
      JSON.stringify({
        check: name,
        error: (error as any).code ?? "provider_unavailable",
      }),
    );
  }
}
