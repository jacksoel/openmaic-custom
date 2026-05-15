import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getConfig } from "@/lib/server/provider-config";

const KEYLESS_PROVIDERS = new Set(["ollama", "lemonade"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authEnabled = process.env.AUTH_ENABLED !== "false";
  if (!authEnabled) {
    return NextResponse.json({ success: false, error: "Auth not enabled" }, { status: 400 });
  }

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== "admin" && user.role !== "instructor") {
      return NextResponse.json({ success: false, error: "Only instructors and admins can test providers" }, { status: 403 });
    }

    const { slug } = await params;

    // Resolve provider: user's own key first, then institutional default
    let apiKey = "";
    let baseUrl: string | undefined;
    let defaultModel: string | undefined;
    let source: "user" | "institutional" = "institutional";

    // 1. Check user's own provider
    try {
      const { getDb } = await import("@/lib/server/auth-db");
      const { decryptApiKey } = await import("@/lib/server/encryption");
      const db = getDb();
      const row = db.prepare(
        "SELECT encryptedApiKey, defaultModel, limits FROM user_providers WHERE userId = ? AND providerSlug = ?"
      ).get(user.id, slug) as any;

      if (row) {
        apiKey = decryptApiKey(row.encryptedApiKey);
        defaultModel = row.defaultModel || undefined;
        source = "user";
      }
    } catch {
      // Auth DB lookup failed — fall through to institutional
    }

    // 2. Fall back to institutional default
    if (!apiKey) {
      const config = getConfig();
      const serverProvider = config.providers?.[slug];
      if (serverProvider) {
        apiKey = serverProvider.apiKey || "";
        baseUrl = serverProvider.baseUrl || undefined;
        defaultModel = defaultModel || serverProvider.models?.[0] || undefined;
        if (serverProvider.apiKey) {
          source = "institutional";
        } else if (serverProvider.baseUrl && KEYLESS_PROVIDERS.has(slug)) {
          // Keyless provider with baseUrl configured (e.g. Ollama)
          source = "institutional";
        }
      }
    }

    const isKeyless = KEYLESS_PROVIDERS.has(slug) && !apiKey && baseUrl;

    if (!apiKey && !isKeyless) {
      return NextResponse.json({
        success: false,
        error: `No ${slug} provider configured. Add an API key or contact your admin.`,
      }, { status: 200 });
    }

    // Build test request
    let testUrl = baseUrl || getProviderTestUrl(slug);
    const testHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      if (slug === "anthropic") {
        testHeaders["x-api-key"] = apiKey;
        testHeaders["anthropic-version"] = "2023-06-01";
      } else if (slug === "google") {
        testUrl = testUrl + "?key=" + apiKey;
      } else {
        testHeaders["Authorization"] = "Bearer " + apiKey;
      }
    }

    try {
      const testRes = await fetch(testUrl, {
        method: "POST",
        headers: testHeaders,
        body: JSON.stringify(getProviderTestPayload(slug, defaultModel)),
      });

      if (testRes.ok || testRes.status === 429) {
        return NextResponse.json({
          success: true,
          message: testRes.status === 429
            ? "Connection verified (rate limited)"
            : "Connection verified",
          provider: slug,
          model: defaultModel,
          source,
        });
      }

      let errorMessage = "Connection failed";
      if (testRes.status === 401) {
        errorMessage = "API key is invalid or expired";
      } else if (testRes.status === 404) {
        errorMessage = "Model or endpoint not found";
      } else {
        errorMessage = "Connection failed: " + testRes.status;
      }

      return NextResponse.json({
        success: false,
        error: errorMessage,
        provider: slug,
      }, { status: 200 });
    } catch {
      return NextResponse.json({
        success: false,
        error: "Cannot connect to API server",
        provider: slug,
      }, { status: 200 });
    }
  } catch (err) {
    console.error("[ProviderTest] Error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

function getProviderTestUrl(slug: string): string {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const urls: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    google: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    grok: "https://api.x.ai/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    ollama: `${ollamaBaseUrl}/api/chat`,
  };
  return urls[slug] || "https://api." + slug + ".com/v1/chat/completions";
}

function getProviderTestPayload(slug: string, defaultModel?: string): object {
  switch (slug) {
    case "openai":
    case "deepseek":
    case "qwen":
    case "grok":
    case "openrouter":
    case "ollama":
      return {
        model: defaultModel || (slug === "ollama" ? "gemma4:latest" : "gpt-4o-mini"),
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
        stream: false,
      };
    case "anthropic":
      return {
        model: defaultModel || "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      };
    case "google":
      return {
        contents: [{ parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      };
    default:
      return { model: defaultModel || "test", messages: [{ role: "user", content: "test" }], max_tokens: 1 };
  }
}