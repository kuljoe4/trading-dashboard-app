export enum ExecutionStatus {
    SUCCESS = 'SUCCESS',
    ORDER_REJECTED = 'ORDER_REJECTED',
    SL_FAILED = 'SL_FAILED',
    CIRCUIT_OPEN = 'CIRCUIT_OPEN',
    UNWIND_FAILED = 'UNWIND_FAILED',
    UNSPECIFIED_ERROR = 'UNSPECIFIED_ERROR'
}

export interface ExecutionResult<T = any> {
    status: ExecutionStatus;
    data?: T;
    error?: string;
    unwindPerformed?: boolean;
}
