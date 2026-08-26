export namespace main {
	
	export class DaemonInfo {
	    url: string;
	    token: string;
	    pid: number;
	
	    static createFrom(source: any = {}) {
	        return new DaemonInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.token = source["token"];
	        this.pid = source["pid"];
	    }
	}
	export class Env {
	    platform: string;
	    arch: string;
	    titlebarInset: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Env(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.arch = source["arch"];
	        this.titlebarInset = source["titlebarInset"];
	    }
	}

}

