export var ExecutionStatus;
(function (ExecutionStatus) {
    ExecutionStatus["SUCCESS"] = "SUCCESS";
    ExecutionStatus["ORDER_REJECTED"] = "ORDER_REJECTED";
    ExecutionStatus["SL_FAILED"] = "SL_FAILED";
    ExecutionStatus["CIRCUIT_OPEN"] = "CIRCUIT_OPEN";
    ExecutionStatus["UNWIND_FAILED"] = "UNWIND_FAILED";
    ExecutionStatus["UNSPECIFIED_ERROR"] = "UNSPECIFIED_ERROR";
})(ExecutionStatus || (ExecutionStatus = {}));
