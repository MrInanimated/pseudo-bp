export function extend(target: any, obj: any): any {
    target = target || {};
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            target[i] = obj[i];
        }
    }
    return target;
}

export function wrapper(thisArg, f, ...args): Promise<any> {
    return new Promise((resolve, reject) => {
        args.push(function (err, ...data) {
            if (err) {
                reject(err);
            }
            else {
                resolve.apply(this, data);
            }
        })
        f.apply(thisArg, args);
    });
}
