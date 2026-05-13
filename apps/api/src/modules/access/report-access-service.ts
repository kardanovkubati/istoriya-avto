export type ReportAccessDecision =
  | {
      status: "granted";
      method: "already_opened" | "test_override";
    }
  | {
      status: "locked";
      options: ["upload_report", "choose_plan"];
      willSpendPoints: false;
      warning: string;
    };

export interface ReportAccessService {
  canViewFullReport(input: {
    vin: string;
    userId: string | null;
    guestSessionId: string | null;
  }): Promise<ReportAccessDecision>;
}

const WRONG_CANDIDATE_WARNING =
  "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается.";

export function createLockedReportAccessService(): ReportAccessService {
  return {
    async canViewFullReport() {
      return {
        status: "locked",
        options: ["upload_report", "choose_plan"],
        willSpendPoints: false,
        warning: WRONG_CANDIDATE_WARNING
      };
    }
  };
}
