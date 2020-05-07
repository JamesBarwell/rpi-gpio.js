
declare module 'epoll' {

    export class Epoll{
        public static EPOLLPRI: string;

        constructor(callback: (error: any, fd: number) => void);

        public add(fileDescriptor: number, event: string): Epoll;
        public remove(fileDescriptor: number): Epoll;
        public close(): Epoll;
    }
}