import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  fromNodeProviderChain,
  fromWebToken,
} from "@aws-sdk/credential-providers";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

console.log("🔑 Have AWS AccessKey?", !!process.env.BAWS_ACCESS_KEY_ID);
console.log("🔑 Have AWS Secret?", !!process.env.BAWS_SECRET_ACCESS_KEY);
console.log("🔑 Have AWS Session Token?", !!process.env.BAWS_SESSION_TOKEN);
console.log("🔑 Have AWS Bearer Token?", !!process.env.BAWS_BEARER_TOKEN);
console.log("🔑 Have AWS Role ARN?", !!process.env.BAWS_ROLE_ARN);

function createBedrockClient(): BedrockAgentRuntimeClient {
  const region = process.env.BAWS_REGION || "us-east-1";

  // Option 1: Bearer token authentication (web identity token exchanged for credentials via STS)
  if (process.env.BAWS_BEARER_TOKEN && process.env.BAWS_ROLE_ARN) {
    console.log("🔐 Using Bearer Token authentication (web identity)");
    return new BedrockAgentRuntimeClient({
      region,
      credentials: fromWebToken({
        roleArn: process.env.BAWS_ROLE_ARN,
        webIdentityToken: process.env.BAWS_BEARER_TOKEN,
        roleSessionName: process.env.BAWS_ROLE_SESSION_NAME || "bedrock-session",
      }),
    });
  }

  // Option 2: Static credentials (with optional session token for temporary credentials)
  if (process.env.BAWS_ACCESS_KEY_ID && process.env.BAWS_SECRET_ACCESS_KEY) {
    const credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    } = {
      accessKeyId: process.env.BAWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BAWS_SECRET_ACCESS_KEY,
    };

    if (process.env.BAWS_SESSION_TOKEN) {
      credentials.sessionToken = process.env.BAWS_SESSION_TOKEN;
      console.log("🔐 Using static credentials with session token");
    } else {
      console.log("🔐 Using static credentials (access key + secret key)");
    }

    return new BedrockAgentRuntimeClient({ region, credentials });
  }

  // Option 3: Default credential provider chain (IAM roles, env vars, SSO, config files, etc.)
  console.log("🔐 Using default AWS credential provider chain");
  return new BedrockAgentRuntimeClient({
    region,
    credentials: fromNodeProviderChain(),
  });
}

const bedrockClient = createBedrockClient();

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface RAGSource {
  id: string;
  fileName: string;
  snippet: string;
  score: number;
}

export async function retrieveContext(
  query: string,
  knowledgeBaseId: string,
  n: number = 3,
): Promise<{
  context: string;
  isRagWorking: boolean;
  ragSources: RAGSource[];
}> {
  try {
    if (!knowledgeBaseId) {
      console.error("knowledgeBaseId is not provided");
      return {
        context: "",
        isRagWorking: false,
        ragSources: [],
      };
    }

    const input: RetrieveCommandInput = {
      knowledgeBaseId: knowledgeBaseId,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: n },
      },
    };

    const command = new RetrieveCommand(input);
    const response = await bedrockClient.send(command);

    // Parse results
    const rawResults = response?.retrievalResults || [];
    const ragSources: RAGSource[] = rawResults
      .filter((res: any) => res.content && res.content.text)
      .map((result: any, index: number) => {
        const uri = result?.location?.s3Location?.uri || "";
        const fileName = uri.split("/").pop() || `Source-${index}.txt`;

        return {
          id:
            result.metadata?.["x-amz-bedrock-kb-chunk-id"] || `chunk-${index}`,
          fileName: fileName.replace(/_/g, " ").replace(".txt", ""),
          snippet: result.content?.text || "",
          score: result.score || 0,
        };
      })
      .slice(0, 1);

    console.log("🔍 Parsed RAG Sources:", ragSources); // Debug log

    const context = rawResults
      .filter((res: any) => res.content && res.content.text)
      .map((res: any) => res.content.text)
      .join("\n\n");

    return {
      context,
      isRagWorking: true,
      ragSources,
    };
  } catch (error) {
    console.error("RAG Error:", error);
    return { context: "", isRagWorking: false, ragSources: [] };
  }
}
