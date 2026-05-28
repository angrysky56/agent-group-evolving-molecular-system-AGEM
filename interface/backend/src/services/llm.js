/**
 * LLM Provider Abstraction.
 *
 * Unified interface for Ollama (local) and OpenRouter (cloud) LLM providers.
 * Handles chat completions with streaming, model listing, and embeddings.
 */
import { settings } from "../config.js";
/* ─── Ollama Provider ─── */
class OllamaProvider {
    type = "ollama";
    #baseUrl;
    constructor(baseUrl) {
        this.#baseUrl = baseUrl.replace(/\/$/, "");
    }
    async chat(options) {
        const config = settings.getLLMConfig();
        let model = options.model ?? config.model;
        if (model.startsWith("ollama:"))
            model = model.substring(7);
        const buildBody = (includeTools) => {
            const body = {
                model,
                messages: options.messages,
                stream: true,
                options: {
                    num_ctx: 32000, // Larger context improves tool calling reliability
                },
            };
            if (includeTools && options.tools && options.tools.length > 0) {
                body.tools = options.tools;
            }
            return body;
        };
        const initialBody = buildBody(true);
        const fs = await import("fs");
        fs.writeFileSync("/tmp/ollama_req.json", JSON.stringify(initialBody, null, 2));
        let response = await fetch(`${this.#baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(initialBody),
            signal: options.signal,
        });
        // Handle models that don't support tools with a fallback retry
        if (response.status === 400) {
            const errorData = (await response.json().catch(() => ({})));
            if (errorData.error &&
                typeof errorData.error === "string" &&
                errorData.error.includes("does not support tools")) {
                console.warn(`[LLM] Model '${model}' does not support tools. Retrying without tools.`);
                response = await fetch(`${this.#baseUrl}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildBody(false)),
                    signal: options.signal,
                });
            }
        }
        if (!response.ok) {
            throw new Error(`Ollama chat failed: ${response.status} ${response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Ollama: No response body reader available");
        }
        const decoder = new TextDecoder();
        let fullContent = "";
        let toolCalls = undefined;
        let promptTokens = 0;
        let completionTokens = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((l) => l.trim());
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.message?.content) {
                        fullContent += parsed.message.content;
                        options.onToken?.(parsed.message.content);
                    }
                    if (parsed.message?.tool_calls) {
                        // Ollama native format: {function: {name, arguments: OBJECT}}
                        // Normalize to add id/type but keep arguments as-is (chat.ts handles both)
                        toolCalls = parsed.message.tool_calls.map((tc, i) => ({
                            id: tc.id ?? `ollama_call_${Date.now()}_${i}`,
                            type: tc.type ?? "function",
                            function: {
                                name: tc.function?.name ?? tc.name,
                                arguments: tc.function?.arguments ?? {},
                            },
                        }));
                    }
                    if (parsed.done) {
                        promptTokens = parsed.prompt_eval_count ?? 0;
                        completionTokens = parsed.eval_count ?? 0;
                        options.onUsage?.({
                            prompt_tokens: promptTokens,
                            completion_tokens: completionTokens,
                            total_tokens: promptTokens + completionTokens,
                        });
                    }
                }
                catch {
                    // Skip malformed JSON lines
                }
            }
        }
        // Fallback: if model output tool calls as text, extract them
        if (!toolCalls && options.tools && options.tools.length > 0) {
            const extracted = OllamaProvider.extractToolCallsFromContent(fullContent);
            if (extracted) {
                console.log(`[LLM] Extracted ${extracted.length} tool call(s) from content text for model '${model}'`);
                toolCalls = extracted;
                // Clear content since it was actually a tool call, not a response
                fullContent = "";
            }
        }
        return {
            content: fullContent,
            tool_calls: toolCalls,
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
            },
        };
    }
    /**
     * Some models accept tools but output calls as JSON/XML text
     * instead of using the structured tool_calls field. Detect and extract.
     */
    static extractToolCallsFromContent(content) {
        if (!content)
            return undefined;
        const trimmed = content.trim();
        // Pattern 1: {"tool_name": "...", "input": {...}}  (nemotron style)
        // Pattern 2: {"name": "...", "arguments": {...}}
        // Pattern 3: ```json\n{...}\n```
        let jsonStr = trimmed;
        // Strip markdown code fences
        const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (fenceMatch) {
            jsonStr = fenceMatch[1].trim();
        }
        // Only try parsing if it looks like JSON
        if (jsonStr.startsWith("{") || jsonStr.startsWith("[")) {
            try {
                const parsed = JSON.parse(jsonStr);
                // Pattern 1: nemotron style
                if (parsed.tool_name &&
                    (parsed.input || parsed.parameters || parsed.arguments)) {
                    return [
                        {
                            id: `call_${Date.now()}`,
                            type: "function",
                            function: {
                                name: parsed.tool_name,
                                arguments: JSON.stringify(parsed.input ?? parsed.parameters ?? parsed.arguments ?? {}),
                            },
                        },
                    ];
                }
                // Pattern 2: OpenAI-ish style
                if (parsed.name && (parsed.arguments || parsed.parameters)) {
                    return [
                        {
                            id: `call_${Date.now()}`,
                            type: "function",
                            function: {
                                name: parsed.name,
                                arguments: JSON.stringify(parsed.arguments ?? parsed.parameters ?? {}),
                            },
                        },
                    ];
                }
                // Pattern 3: Array of tool calls
                if (Array.isArray(parsed)) {
                    const calls = parsed
                        .filter((t) => t.tool_name || t.name || t.function?.name)
                        .map((t, i) => ({
                        id: `call_${Date.now()}_${i}`,
                        type: "function",
                        function: {
                            name: t.tool_name ?? t.name ?? t.function?.name,
                            arguments: JSON.stringify(t.input ??
                                t.arguments ??
                                t.parameters ??
                                t.function?.arguments ??
                                {}),
                        },
                    }));
                    if (calls.length > 0)
                        return calls;
                }
            }
            catch {
                // Not valid JSON — proceed to check for XML
            }
        }
        // Pattern 4: MiniMax XML style <minimax:tool_call name="..." id="...">...</minimax:tool_call>
        const xmlMatch = trimmed.match(/<minimax:tool_call\s+name="([^"]+)"\s*(?:id="([^"]+)")?>(.*?)<\/minimax:tool_call>/s);
        if (xmlMatch) {
            return [
                {
                    id: xmlMatch[2] || `call_${Date.now()}`,
                    type: "function",
                    function: {
                        name: xmlMatch[1],
                        arguments: xmlMatch[3].trim(),
                    },
                },
            ];
        }
        return undefined;
    }
    async listModels() {
        try {
            const response = await fetch(`${this.#baseUrl}/api/tags`);
            if (!response.ok)
                return [];
            const data = (await response.json());
            // Query each model's actual capabilities via /api/show
            const models = [];
            for (const m of data.models ?? []) {
                const nameLower = m.name.toLowerCase();
                const isEmbedding = nameLower.includes("embed") ||
                    nameLower.includes("nomic") ||
                    nameLower.includes("bert");
                // Check capabilities from /api/show (fast local call)
                let supportsTools = false;
                let contextLength = 0;
                try {
                    const showResp = await fetch(`${this.#baseUrl}/api/show`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ model: m.name }),
                    });
                    if (showResp.ok) {
                        const showData = (await showResp.json());
                        supportsTools = showData.capabilities?.includes("tools") ?? false;
                        // Extract context_length from model_info if available
                        const infoKeys = Object.keys(showData.model_info ?? {});
                        const ctxKey = infoKeys.find((k) => k.endsWith(".context_length"));
                        if (ctxKey && showData.model_info) {
                            contextLength = showData.model_info[ctxKey] ?? 0;
                        }
                    }
                }
                catch {
                    // /api/show failed — leave defaults
                }
                models.push({
                    id: m.name,
                    name: m.name,
                    provider: "ollama",
                    context_length: contextLength,
                    description: m.details?.parameter_size
                        ? `${m.details.family ?? ""} ${m.details.parameter_size}`.trim()
                        : undefined,
                    type: isEmbedding ? "embedding" : "chat",
                    supports_tools: supportsTools,
                });
            }
            return models;
        }
        catch (error) {
            console.error("[LLM] Failed to list Ollama models:", error);
            return [];
        }
    }
    /** Get embeddings via Ollama /api/embeddings endpoint. */
    async getEmbedding(text, model, signal) {
        let embModel = model ?? settings.all.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text:latest";
        if (embModel.startsWith("ollama:"))
            embModel = embModel.substring(7);
        try {
            const response = await fetch(`${this.#baseUrl}/api/embeddings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: embModel, prompt: text }),
                signal,
            });
            if (!response.ok) {
                console.error(`[LLM] Ollama embedding failed: ${response.status}`);
                return [];
            }
            const data = (await response.json());
            return data.embedding ?? [];
        }
        catch (error) {
            console.error("[LLM] Ollama embedding error:", error);
            return [];
        }
    }
}
/* ─── OpenRouter Provider ─── */
class OpenRouterProvider {
    type = "openrouter";
    #baseUrl;
    constructor(baseUrl) {
        this.#baseUrl = baseUrl.replace(/\/$/, "");
    }
    /** Get the API key, preferring runtime header over provider-specific config. */
    #getApiKey(headerKey) {
        return headerKey ?? settings.all.OPENROUTER_API_KEY;
    }
    async chat(options) {
        let model = options.model ?? settings.all.OPENROUTER_MODEL;
        if (model.startsWith("openrouter:"))
            model = model.substring(11);
        const apiKey = this.#getApiKey(options.apiKey);
        const bodyObj = {
            model,
            messages: options.messages,
            stream: true,
            max_tokens: 4096,
        };
        if (options.tools && options.tools.length > 0) {
            bodyObj.tools = options.tools;
        }
        const response = await fetch(`${this.#baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://agem.local",
                "X-Title": "AGEM Molecular Agent System",
            },
            body: JSON.stringify(bodyObj),
            signal: options.signal,
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`OpenRouter chat failed: ${response.status} — ${errorText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("OpenRouter: No response body reader available");
        }
        const decoder = new TextDecoder();
        let fullContent = "";
        let thinking = "";
        let toolCallsMap = {};
        let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        // Read timeout: if no data arrives for 90s, abort the stream
        const READ_TIMEOUT_MS = 90_000;
        let lastDataTime = Date.now();
        let buffer = "";
        while (true) {
            let timeoutId = null;
            const readPromise = reader.read();
            const timeoutPromise = new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    const silenceMs = Date.now() - lastDataTime;
                    console.warn(`[LLM] OpenRouter read timeout after ${Math.round(silenceMs / 1000)}s silence — aborting stream`);
                    reader.cancel().catch(() => { });
                    resolve({ value: undefined, done: true });
                }, READ_TIMEOUT_MS);
            });
            const { value, done } = await Promise.race([readPromise, timeoutPromise]);
            // CRITICAL: clear the timeout so it doesn't fire later and kill a future read
            if (timeoutId !== null)
                clearTimeout(timeoutId);
            if (done)
                break;
            lastDataTime = Date.now();
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const rawLines = buffer.split("\n");
            buffer = rawLines.pop() || ""; // Save partial line for next chunk
            for (const line of rawLines) {
                if (!line.startsWith("data: "))
                    continue;
                const dataStr = line.slice(6).trim();
                if (dataStr === "[DONE]")
                    continue;
                try {
                    const parsed = JSON.parse(dataStr);
                    // Handle OpenRouter error responses embedded in stream
                    if (parsed.error) {
                        const errMsg = parsed.error.message ?? "Unknown stream error";
                        console.error(`[LLM] OpenRouter stream error: ${errMsg} (code: ${parsed.error.code})`);
                        if (errMsg.includes("rate limit") || parsed.error.code === 429) {
                            throw new Error(`OpenRouter rate limited: ${errMsg}`);
                        }
                        throw new Error(`OpenRouter stream error: ${errMsg}`);
                    }
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.content) {
                        fullContent += delta.content;
                        options.onToken?.(delta.content);
                    }
                    if (delta?.reasoning) {
                        thinking += delta.reasoning;
                        options.onThinking?.(delta.reasoning);
                    }
                    if (delta?.tool_calls) {
                        for (const call of delta.tool_calls) {
                            const idx = call.index ?? 0;
                            if (!toolCallsMap[idx])
                                toolCallsMap[idx] = {
                                    id: call.id,
                                    type: call.type,
                                    function: { name: "", arguments: "" },
                                };
                            if (call.id)
                                toolCallsMap[idx].id = call.id;
                            if (call.function?.name)
                                toolCallsMap[idx].function.name += call.function.name;
                            if (call.function?.arguments)
                                toolCallsMap[idx].function.arguments += call.function.arguments;
                        }
                    }
                    if (parsed.usage) {
                        usage = {
                            prompt_tokens: parsed.usage.prompt_tokens ?? 0,
                            completion_tokens: parsed.usage.completion_tokens ?? 0,
                            total_tokens: parsed.usage.total_tokens ?? 0,
                        };
                        options.onUsage?.(usage);
                    }
                    // Detect truncation or completion
                    const finishReason = parsed.choices?.[0]?.finish_reason;
                    if (finishReason === "length") {
                        console.warn(`[LLM] OpenRouter response truncated (finish_reason=length). Increase max_tokens.`);
                    }
                }
                catch {
                    // Skip malformed data
                }
            }
        }
        let finalToolCalls = Object.values(toolCallsMap);
        if (finalToolCalls.length === 0)
            finalToolCalls = undefined;
        return {
            content: fullContent,
            thinking: thinking || undefined,
            tool_calls: finalToolCalls,
            usage,
        };
    }
    async listModels(apiKey) {
        const key = this.#getApiKey(apiKey);
        const authHeaders = {
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": "https://agem.local",
        };
        try {
            const response = await fetch(`${this.#baseUrl}/models`, {
                headers: authHeaders,
            });
            if (!response.ok)
                return [];
            const data = (await response.json());
            const models = (data.data ?? []).map((m) => ({
                id: m.id,
                name: m.name ?? m.id,
                provider: "openrouter",
                context_length: m.context_length ?? m.top_provider?.context_length ?? 0,
                description: m.description,
                type: m.id.toLowerCase().includes("embed")
                    ? "embedding"
                    : "chat",
                pricing: m.pricing,
                supports_tools: m.supported_parameters?.includes("tools") ?? false,
            }));
            // Fetch embedding models from separate endpoint (per graph-rlm pattern)
            try {
                const embResponse = await fetch(`${this.#baseUrl}/embeddings/models`, {
                    headers: authHeaders,
                });
                if (embResponse.ok) {
                    const embData = (await embResponse.json());
                    for (const em of embData.data ?? []) {
                        // Skip if already in chat models list
                        if (!models.some((m) => m.id === em.id)) {
                            models.push({
                                id: em.id,
                                name: em.name ?? em.id,
                                provider: "openrouter",
                                context_length: em.context_length ?? 0,
                                type: "embedding",
                                pricing: em.pricing,
                                supports_tools: false,
                            });
                        }
                    }
                }
            }
            catch {
                // Embedding models endpoint may not be available
            }
            return models;
        }
        catch (error) {
            console.error("[LLM] Failed to list OpenRouter models:", error);
            return [];
        }
    }
    /** Get embeddings via OpenRouter /embeddings endpoint (OpenAI format). */
    async getEmbedding(text, model, signal) {
        let embModel = model ??
            settings.all.OPENROUTER_EMBEDDING_MODEL ??
            "google/gemini-embedding-001";
        if (embModel.startsWith("openrouter:"))
            embModel = embModel.substring(11);
        const key = this.#getApiKey();
        try {
            const response = await fetch(`${this.#baseUrl}/embeddings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${key}`,
                    "HTTP-Referer": "https://agem.local",
                },
                body: JSON.stringify({ model: embModel, input: text }),
                signal,
            });
            if (!response.ok) {
                console.error(`[LLM] OpenRouter embedding failed: ${response.status}`);
                return [];
            }
            const data = (await response.json());
            return data.data?.[0]?.embedding ?? [];
        }
        catch (error) {
            console.error("[LLM] OpenRouter embedding error:", error);
            return [];
        }
    }
}
/* ─── Anthropic Provider ─── */
class AnthropicProvider {
    type = "anthropic";
    #baseUrl;
    constructor(baseUrl) {
        this.#baseUrl = baseUrl.replace(/\/$/, "");
    }
    /** Get the API key, preferring runtime header over provider-specific config. */
    #getApiKey(headerKey) {
        return headerKey ?? settings.all.ANTHROPIC_API_KEY;
    }
    /** Convert common ChatCompletionOptions to Anthropic's payload format. */
    static toAnthropicPayload(options, model) {
        // Filter out system messages
        const systemMessages = options.messages.filter((m) => m.role === "system");
        const otherMessages = options.messages.filter((m) => m.role !== "system");
        // Convert system messages to content blocks (to support caching)
        const system = systemMessages.length > 0
            ? systemMessages
                .map((m) => {
                if (typeof m.content === "string") {
                    const block = { type: "text", text: m.content };
                    if (m.cache_control)
                        block.cache_control = m.cache_control;
                    return block;
                }
                return m.content;
            })
                .flat()
            : undefined;
        // Convert tools
        const tools = options.tools?.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
        }));
        // Convert other messages
        const messages = [];
        let pendingToolResults = [];
        for (const m of otherMessages) {
            const isTool = m.role === "tool" || !!m.tool_call_id;
            if (isTool) {
                if (!m.tool_call_id) {
                    console.warn(`[LLM] Skipping tool result for role 'tool' with missing tool_call_id (Name: ${m.name || "unknown"}, Content: ${typeof m.content === "string" ? m.content.slice(0, 50) : "[object]"}) in Anthropic payload`);
                    continue;
                }
                pendingToolResults.push({
                    type: "tool_result",
                    tool_use_id: m.tool_call_id,
                    content: m.content,
                });
                continue;
            }
            // If we have tool results pending and move to a non-tool message, flush them
            if (pendingToolResults.length > 0) {
                messages.push({
                    role: "user",
                    content: pendingToolResults,
                });
                pendingToolResults = [];
            }
            if (m.role === "assistant") {
                const content = [];
                if (m.content) {
                    content.push({ type: "text", text: m.content });
                }
                if (m.tool_calls) {
                    for (const tc of m.tool_calls) {
                        let input = {};
                        if (typeof tc.function.arguments === "string") {
                            try {
                                input = JSON.parse(tc.function.arguments || "{}");
                            }
                            catch (e) {
                                console.warn(`[LLM] Failed to parse tool arguments in history for ${tc.function.name}, attempting repair...`);
                                // Attempt simple repair: find last closing brace
                                const raw = tc.function.arguments || "{}";
                                const lastBrace = raw.lastIndexOf("}");
                                if (lastBrace > 0) {
                                    try {
                                        input = JSON.parse(raw.substring(0, lastBrace + 1));
                                    }
                                    catch {
                                        input = {};
                                    }
                                }
                                else {
                                    input = {};
                                }
                            }
                        }
                        else {
                            input = tc.function.arguments || {};
                        }
                        content.push({
                            type: "tool_use",
                            id: tc.id,
                            name: tc.function.name,
                            input,
                        });
                    }
                }
                messages.push({ role: "assistant", content });
            }
            else {
                // User message
                let content = m.content;
                if (typeof content === "string" && m.cache_control) {
                    content = [
                        { type: "text", text: content, cache_control: m.cache_control },
                    ];
                }
                messages.push({
                    role: m.role === "system" ? "user" : m.role,
                    content,
                });
            }
        }
        // Flush any remaining tool results
        if (pendingToolResults.length > 0) {
            messages.push({
                role: "user",
                content: pendingToolResults,
            });
        }
        return {
            model,
            messages,
            system,
            tools: tools && tools.length > 0 ? tools : undefined,
            max_tokens: 8192,
            stream: true,
        };
    }
    async chat(options) {
        const config = settings.getLLMConfig();
        let model = options.model ?? config.model;
        if (model.startsWith("anthropic:"))
            model = model.substring(10);
        const apiKey = this.#getApiKey(options.apiKey);
        const bodyObj = AnthropicProvider.toAnthropicPayload(options, model);
        const url = this.#baseUrl.endsWith("/v1")
            ? `${this.#baseUrl}/messages`
            : `${this.#baseUrl}/v1/messages`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(bodyObj),
            signal: options.signal,
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`Anthropic chat failed: ${response.status} — ${errorText}`);
        }
        return AnthropicProvider.handleAnthropicStream(response, options);
    }
    /** Static helper to handle Anthropic's SSE stream format. */
    static async handleAnthropicStream(response, options) {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Anthropic: No response body reader available");
        }
        const decoder = new TextDecoder();
        let fullContent = "";
        let toolCalls = [];
        let usage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };
        let buffer = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Save partial line for next chunk
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith("data: "))
                    continue;
                const dataStr = line.slice(6).trim();
                if (dataStr === "[DONE]")
                    continue;
                try {
                    const evt = JSON.parse(dataStr);
                    if (evt.type === "message_start") {
                        usage.prompt_tokens = evt.message.usage.input_tokens;
                        usage.cache_creation_input_tokens =
                            evt.message.usage.cache_creation_input_tokens || 0;
                        usage.cache_read_input_tokens =
                            evt.message.usage.cache_read_input_tokens || 0;
                    }
                    else if (evt.type === "content_block_delta" &&
                        evt.delta.type === "text_delta") {
                        fullContent += evt.delta.text;
                        options.onToken?.(evt.delta.text);
                    }
                    else if (evt.type === "content_block_start" &&
                        evt.content_block.type === "tool_use") {
                        // Robust ID capture: check content_block.id, then top-level id, then fallback
                        const toolId = evt.content_block.id ||
                            evt.id ||
                            `call_${Math.random().toString(36).substring(2, 11)}`;
                        console.log(`[LLM] Anthropic/MiniMax tool_use start: idx=${evt.index}, id=${toolId}, name=${evt.content_block.name}`);
                        toolCalls[evt.index] = {
                            id: toolId,
                            type: "function",
                            function: {
                                name: evt.content_block.name,
                                arguments: "",
                            },
                        };
                    }
                    else if (evt.type === "content_block_delta" &&
                        evt.delta.type === "input_json_delta") {
                        if (toolCalls[evt.index]) {
                            toolCalls[evt.index].function.arguments += evt.delta.partial_json;
                        }
                    }
                    else if (evt.type === "message_delta") {
                        usage.completion_tokens = evt.usage.output_tokens;
                    }
                }
                catch (err) {
                    console.error(`[LLM] Failed to parse Anthropic stream chunk: ${err}`);
                }
            }
        }
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
        let finalToolCalls = toolCalls.filter(Boolean);
        if (finalToolCalls.length === 0 && fullContent.trim()) {
            // Fallback for models that output XML/JSON in text delta (like MiniMax M2.5)
            const extracted = OllamaProvider.extractToolCallsFromContent(fullContent);
            if (extracted) {
                console.log(`[LLM] Extracted ${extracted.length} tool call(s) from Anthropic text stream for model '${options.model}'`);
                finalToolCalls = extracted;
                fullContent = ""; // Clear narration if it was purely a tool call wrapper
            }
        }
        if (finalToolCalls.length === 0)
            finalToolCalls = undefined;
        return {
            content: fullContent,
            tool_calls: finalToolCalls,
            usage,
        };
    }
    async listModels() {
        return [
            {
                id: "claude-3-5-sonnet-20241022",
                name: "Claude 3.5 Sonnet",
                provider: "anthropic",
                context_length: 200000,
                type: "chat",
            },
            {
                id: "claude-3-5-haiku-20241022",
                name: "Claude 3.5 Haiku",
                provider: "anthropic",
                context_length: 200000,
                type: "chat",
            },
        ];
    }
    async getEmbedding(_text, _model, _signal) {
        console.warn("[LLM] Anthropic does not provide an embedding API.");
        return [];
    }
}
/* ─── MiniMax Provider ─── */
class MinimaxProvider {
    type = "minimax";
    #baseUrl;
    constructor(baseUrl) {
        this.#baseUrl = baseUrl.replace(/\/$/, "");
    }
    /** Get the API key, preferring runtime header over provider-specific config. */
    #getApiKey(headerKey) {
        return headerKey ?? settings.all.MINIMAX_API_KEY;
    }
    async chat(options) {
        const apiKey = this.#getApiKey(options.apiKey);
        let model = options.model ?? settings.all.MINIMAX_MODEL;
        if (model.startsWith("minimax:"))
            model = model.substring(8);
        // If using Anthropic-compatible endpoint
        if (this.#baseUrl.includes("anthropic")) {
            const bodyObj = AnthropicProvider.toAnthropicPayload(options, model);
            const url = this.#baseUrl.endsWith("/v1")
                ? `${this.#baseUrl}/messages`
                : `${this.#baseUrl}/v1/messages`;
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(bodyObj),
                signal: options.signal,
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => "Unknown error");
                throw new Error(`MiniMax (Anthropic) chat failed: ${response.status} — ${errorText}`);
            }
            return AnthropicProvider.handleAnthropicStream(response, options);
        }
        // Default OpenAI-compatible endpoint
        const bodyObj = {
            model,
            messages: options.messages,
            stream: true,
        };
        if (options.tools && options.tools.length > 0) {
            bodyObj.tools = options.tools;
        }
        const groupId = settings.all.MINIMAX_GROUP_ID;
        const url = groupId
            ? `${this.#baseUrl}/chat/completions?GroupId=${groupId}`
            : `${this.#baseUrl}/chat/completions`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(bodyObj),
            signal: options.signal,
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`MiniMax chat failed: ${response.status} — ${errorText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("MiniMax: No response body reader available");
        }
        const decoder = new TextDecoder();
        let fullContent = "";
        let toolCallsMap = {};
        let usage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };
        let buffer = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const rawLines = buffer.split("\n");
            buffer = rawLines.pop() || ""; // Save partial line for next chunk
            for (const line of rawLines) {
                if (!line.startsWith("data: "))
                    continue;
                const dataStr = line.slice(6).trim();
                if (dataStr === "[DONE]")
                    continue;
                try {
                    const parsed = JSON.parse(dataStr);
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.content) {
                        fullContent += delta.content;
                        options.onToken?.(delta.content);
                    }
                    if (delta?.tool_calls) {
                        for (const call of delta.tool_calls) {
                            const idx = call.index ?? 0;
                            if (!toolCallsMap[idx])
                                toolCallsMap[idx] = {
                                    id: call.id || `call_${Date.now()}_${idx}`,
                                    type: call.type ?? "function",
                                    function: { name: "", arguments: "" },
                                };
                            if (call.id)
                                toolCallsMap[idx].id = call.id;
                            if (call.function?.name)
                                toolCallsMap[idx].function.name += call.function.name;
                            if (call.function?.arguments)
                                toolCallsMap[idx].function.arguments += call.function.arguments;
                        }
                    }
                    if (parsed.usage) {
                        usage.prompt_tokens = parsed.usage.prompt_tokens ?? 0;
                        usage.completion_tokens = parsed.usage.completion_tokens ?? 0;
                        usage.total_tokens = parsed.usage.total_tokens ?? 0;
                        if (parsed.usage.prompt_tokens_details?.cached_tokens) {
                            usage.cache_read_input_tokens =
                                parsed.usage.prompt_tokens_details.cached_tokens;
                        }
                    }
                }
                catch {
                    // Skip malformed data
                }
            }
        }
        let finalToolCalls = Object.values(toolCallsMap);
        if (finalToolCalls.length === 0)
            finalToolCalls = undefined;
        return {
            content: fullContent,
            tool_calls: finalToolCalls,
            usage,
        };
    }
    async listModels() {
        const apiKey = this.#getApiKey();
        try {
            // 1. Try Anthropic-compatible models list if base URL suggests it
            if (this.#baseUrl.includes("anthropic")) {
                const response = await fetch(`${this.#baseUrl}/v1/models`, {
                    headers: { "x-api-key": apiKey },
                });
                if (response.ok) {
                    const data = (await response.json());
                    if (data.data && Array.isArray(data.data)) {
                        return data.data.map((m) => ({
                            id: m.id,
                            name: m.display_name ?? m.id,
                            provider: "minimax",
                            context_length: m.context_window ?? 128000,
                            type: m.type === "model" ? "chat" : m.type,
                            supports_tools: true,
                        }));
                    }
                }
            }
            // 2. Fallback to standard V1 models list
            const isAnthropic = this.#baseUrl.includes("anthropic");
            const url = isAnthropic
                ? "https://api.minimax.io/v1/models"
                : `${this.#baseUrl}/models`;
            const response = await fetch(url, {
                headers: isAnthropic
                    ? { "x-api-key": apiKey }
                    : { Authorization: `Bearer ${apiKey}` },
            });
            if (response.ok) {
                const data = (await response.json());
                if (data.data && Array.isArray(data.data)) {
                    return data.data.map((m) => ({
                        id: m.id,
                        name: m.id,
                        provider: "minimax",
                        context_length: 128000, // Default for MiniMax 6.x/M2.x
                        type: m.id.includes("embo") ? "embedding" : "chat",
                        supports_tools: !m.id.includes("embo"),
                    }));
                }
            }
        }
        catch (error) {
            console.warn("[LLM] MiniMax listModels failed:", error);
        }
        // 3. Last resort: Hardcoded fallback (updated)
        return [
            {
                id: "MiniMax-M2.7",
                name: "MiniMax-M2.7 (Current)",
                provider: "minimax",
                context_length: 128000,
                type: "chat",
                supports_tools: true,
            },
            {
                id: "abab6.5s-chat",
                name: "MiniMax abab6.5s",
                provider: "minimax",
                context_length: 128000,
                type: "chat",
                supports_tools: true,
            },
            {
                id: "embo-01",
                name: "MiniMax embo-01 (Embedding)",
                provider: "minimax",
                context_length: 4096,
                type: "embedding",
            },
        ];
    }
    async getEmbedding(text, model, signal) {
        const apiKey = this.#getApiKey();
        let embModel = model ?? settings.all.MINIMAX_EMBEDDING_MODEL ?? "embo-01";
        if (embModel.startsWith("minimax:"))
            embModel = embModel.substring(8);
        try {
            const groupId = settings.all.MINIMAX_GROUP_ID;
            const url = groupId
                ? `${this.#baseUrl}/embeddings?GroupId=${groupId}`
                : `${this.#baseUrl}/embeddings`;
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: embModel,
                    texts: [text],
                    type: "db",
                }),
                signal,
            });
            if (!response.ok) {
                console.error(`[LLM] MiniMax embedding failed: ${response.status}`);
                return [];
            }
            const data = (await response.json());
            if (data.data?.[0]?.embedding)
                return data.data[0].embedding;
            if (data.vectors?.[0])
                return data.vectors[0];
            return [];
        }
        catch (error) {
            console.error("[LLM] MiniMax embedding error:", error);
            return [];
        }
    }
}
/* ─── Factory ─── */
/** Create the appropriate LLM provider based on configuration. */
export function createProvider(type) {
    const providerType = type ?? settings.getLLMConfig().provider;
    const allConfig = settings.all;
    // Use provider-specific config, not just the active provider's config
    switch (providerType) {
        case "ollama":
            return new OllamaProvider(allConfig.OLLAMA_BASE_URL || "http://localhost:11434");
        case "openrouter":
            return new OpenRouterProvider(allConfig.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1");
        case "anthropic":
            return new AnthropicProvider(allConfig.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1");
        case "minimax":
            return new MinimaxProvider(allConfig.MINIMAX_BASE_URL || "https://api.minimax.chat/v1");
        default:
            throw new Error(`Unknown LLM provider: ${providerType}`);
    }
}
export function getActiveProvider() {
    return createProvider();
}
//# sourceMappingURL=llm.js.map