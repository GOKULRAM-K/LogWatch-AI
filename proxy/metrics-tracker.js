class MetricsTracker{
    constructor(){
        this.totalRequests=0;
        this.successCount=0;
        this.failureCount=0;
    }
recordRequest(StatusCode) {
    this.totalRequests++;

    if(StatusCode>=400){
        this.failureCount++;
    }else{
        this.successCount++;
    }
}
getMetrics() {
    return {
        totalRequests: this.totalRequests,
        successCount:this.successCount,
        failureCount: this.failureCount
    };
}
}


module.exports=MetricsTracker