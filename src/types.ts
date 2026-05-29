export type EnvLike = Record<string, unknown> & {
  CHECKIN_DB?: CheckinLogDatabase;
};

export type CheckinLogDatabase = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run?: () => Promise<unknown>;
      all?: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
    };
    run?: () => Promise<unknown>;
    all?: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  };
};

export type AccountConfig = {
  name: string;
  cookie: string;
};

export type CheckinStatus = "success" | "already_checked_in" | "expired" | "failed";

export type AccountRunResult = {
  accountName: string;
  checkin: {
    status: CheckinStatus;
    message: string;
    httpStatus?: number;
  };
  accountStatus?: {
    leftDays?: string;
    message?: string;
  };
};

export type Summary = {
  total: number;
  ok: number;
  failed: number;
  expired: number;
};

export type NotificationChannel =
  | {
      channel: "dingtalk";
      webhook: string;
      secret?: string;
    }
  | {
      channel: "telegram";
      botToken: string;
      chatId: string;
    }
  | {
      channel: "feishu";
      webhook: string;
      secret?: string;
    };

export type NotificationResult = {
  channel: NotificationChannel["channel"];
  ok: boolean;
  error?: string;
};

export type NotificationSummary = {
  configured: number;
  attempted: number;
  succeeded: number;
  failed: number;
};

export type AppConfig = {
  accounts: AccountConfig[];
  adminUser: string;
  adminToken?: string;
  checkinConcurrency: number;
  checkinRetries: number;
  notifyOnStatusOnly: boolean;
  notifications: NotificationChannel[];
};

export type RunReport = {
  ok: boolean;
  trigger: "manual" | "scheduled";
  startedAt: string;
  summary: Summary;
  results: AccountRunResult[];
  notifications: NotificationResult[];
  notificationSummary: NotificationSummary;
};

export type Fetcher = typeof fetch;

export type CheckinLogRow = {
  id: number;
  accountName: string;
  checkedAt: string;
  status: CheckinStatus;
  message: string;
  points: number;
  leftDays?: string;
  trigger: RunReport["trigger"];
};
