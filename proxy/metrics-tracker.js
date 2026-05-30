class MetricsTracker{
    constructor(){
        this.totalRequests=0;
    }
recordRequest() {
    this.totalRequests++;
}
getMetrics() {
    return {
        totalRequests: this.totalRequests
    };
}
}


module.exports=MetricsTracker