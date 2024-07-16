/* eslint-disable no-unused-vars */
import koffi from 'koffi';

const BOOL = koffi.alias('BOOL', 'int');
const CHAR = koffi.alias('CHAR', 'char');
const WORD = koffi.alias('WORD', 'uint16_t');
const DWORD = koffi.alias('DWORD', 'uint32_t');
const LONG = koffi.alias('LONG', 'long');
const UINT = koffi.alias('UINT', 'uint32_t');
const ULONG_PTR = koffi.alias('ULONG_PTR', 'uintptr_t');
const LPVOID = koffi.pointer('LPVOID', koffi.opaque());
const LPSTR = koffi.pointer('LPSTR', CHAR);
const HANDLE = koffi.alias('HANDLE', LPVOID);
const HWND = koffi.alias('HWND', HANDLE);
const HGLOBAL = koffi.alias('HGLOBAL', HANDLE);

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
    dx: LONG,
    dy: LONG,
    mouseData: DWORD,
    dwFlags: DWORD,
    time: DWORD,
    dwExtraInfo: ULONG_PTR
});
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
    wVk: WORD,
    wScan: WORD,
    dwFlags: DWORD,
    time: DWORD,
    dwExtraInfo: ULONG_PTR
});
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
    uMsg: DWORD,
    wParamL: WORD,
    wParamH: WORD
});
const INPUT = koffi.struct('INPUT', {
    type: DWORD,
    u: koffi.union({
        mi: MOUSEINPUT,
        ki: KEYBDINPUT,
        hi: HARDWAREINPUT
    })
});
const LPINPUT = koffi.pointer('LPINPUT', INPUT);

const CF_TEXT = 1;
const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const INPUT_HARDWARE = 2;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;

// https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
const VK_BACK = 0x08;
const VK_TAB = 0x09;
const VK_RETURN = 0x0D;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_ESCAPE = 0x1B;
const VK_SPACE = 0x20;
const VK_END = 0x23;
const VK_HOME = 0x24;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_DELETE = 0x2E;
const VK_LSHIFT = 0xA0;
const VK_RSHIFT = 0xA1;
const VK_LCONTROL = 0xA2;
const VK_RCONTROL = 0xA3;
const VK_LMENU = 0xA4;
const VK_RMENU = 0xA5;

const kernel32 = koffi.load('kernel32.dll');
const user32 = koffi.load('user32.dll');
const OpenClipboard = user32.func('BOOL __stdcall OpenClipboard(HWND hWndNewOwner)');
const GetClipboardData = user32.func('HANDLE __stdcall GetClipboardData(UINT uFormat)');
const EmptyClipboard = user32.func('BOOL __stdcall EmptyClipboard()');
const CloseClipboard = user32.func('BOOL __stdcall CloseClipboard()');
const SendInput = user32.func('UINT __stdcall SendInput(UINT cInputs, LPINPUT pInputs, int cbSize)');
const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()');
const GetWindowText = user32.func('int __stdcall GetWindowTextA(HWND hWnd, _Out_ LPSTR lpString, int nMaxCount)');
const GlobalLock = kernel32.func('LPVOID __stdcall GlobalLock(HGLOBAL hMem)');
const GlobalUnlock = kernel32.func('LPVOID __stdcall GlobalUnlock(HGLOBAL hMem)');
const GetLastError = kernel32.func('DWORD __stdcall GetLastError()');

function throwLastError() {
    const errorCode = GetLastError();
    if (errorCode !== 0) {
        throw new Error(`Win32Error: 0x${errorCode.toString(16).padStart(8, '0')}`);
    }
}

export function getClipboardText() {
    const openClipboardResult = OpenClipboard(null);
    if (!openClipboardResult) {
        throwLastError();
        return null;
    }
    try {
        const handle = GetClipboardData(CF_TEXT);
        if (!handle) {
            throwLastError();
            return null;
        }
        const clipboardData = GlobalLock(handle);
        if (!clipboardData) {
            throwLastError();
            return null;
        }
        const result = koffi.decode(clipboardData, 'char', -1);
        GlobalUnlock(handle);
        return result;
    } finally {
        CloseClipboard();
    }
}

export function emptyClipboard() {
    const openClipboardResult = OpenClipboard(null);
    if (!openClipboardResult) {
        throwLastError();
        return null;
    }
    try {
        return EmptyClipboard();
    } finally {
        CloseClipboard();
    }
}

export const Keys = {
    Backspace: VK_BACK,
    Tab: VK_TAB,
    Enter: VK_RETURN,
    Shift: VK_SHIFT,
    Ctrl: VK_CONTROL,
    Alt: VK_MENU,
    Esc: VK_ESCAPE,
    Space: VK_SPACE,
    End: VK_END,
    Home: VK_HOME,
    Left: VK_LEFT,
    Up: VK_UP,
    Right: VK_RIGHT,
    Down: VK_DOWN,
    Delete: VK_DELETE,
    LeftShift: VK_LSHIFT,
    LeftCtrl: VK_LCONTROL,
    LeftAlt: VK_LMENU,
    RightShift: VK_RSHIFT,
    RightCtrl: VK_RCONTROL,
    RightAlt: VK_RMENU
};

export function sendKeys(...virtualKeys) {
    const keyEvents = [];
    const vkCodes = virtualKeys.map((e) => {
        if (typeof e === 'string') {
            if (e.length === 1) {
                return e.charCodeAt(0);
            }
            if (e in Keys) {
                return Keys[e];
            }
            throw new Error(`Cannot find key: ${e}`);
        }
        return e;
    });
    for (const vk of vkCodes) {
        keyEvents.push({
            type: INPUT_KEYBOARD,
            u: {
                ki: {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0
                }
            }
        });
    }
    for (const vk of vkCodes.reverse()) {
        keyEvents.push({
            type: INPUT_KEYBOARD,
            u: {
                ki: {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0
                }
            }
        });
    }
    return SendInput(keyEvents.length, keyEvents, koffi.sizeof(INPUT));
}

export function sendText(text) {
    const keyEvents = [];
    const scanCodes = text.split('').map((ch) => ch.charCodeAt(0));
    for (const scan of scanCodes) {
        keyEvents.push({
            type: INPUT_KEYBOARD,
            u: {
                ki: {
                    wVk: 0,
                    wScan: scan,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0
                }
            }
        });
        keyEvents.push({
            type: INPUT_KEYBOARD,
            u: {
                ki: {
                    wVk: 0,
                    wScan: scan,
                    // eslint-disable-next-line no-bitwise
                    dwFlags: KEYEVENTF_KEYUP | KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0
                }
            }
        });
    }
    return SendInput(keyEvents.length, keyEvents, koffi.sizeof(INPUT));
}

export function getForegroundWindowTitle() {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const buffer = Buffer.allocUnsafe(1024);
    const length = GetWindowText(hwnd, buffer, buffer.length);
    if (!length) {
        throwLastError();
        return null;
    }
    return koffi.decode(buffer, 'char', length);
}
