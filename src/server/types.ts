export interface APIRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
}

export interface APIResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface ExecRequest {
  command: string;
  params?: Record<string, unknown>;
  session?: string;
}

export interface ChainRequest {
  chain: string;
  session?: string;
  cdpEndpoint?: string;
}

export interface SessionCreateRequest {
  name: string;
  url?: string;
  cdpEndpoint?: string;
}

export interface HTTPServerError {
  error: string;
  message: string;
  statusCode: number;
}

export interface HTTPServerConfig {
  port?: number;
  host?: string;
  tokens?: string[];
}
