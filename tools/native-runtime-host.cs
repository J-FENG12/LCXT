using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("旅策协同原生窗口宿主")]
[assembly: System.Reflection.AssemblyProduct("旅策协同 Travel.AI")]
[assembly: System.Reflection.AssemblyCompany("旅策协同")]
[assembly: System.Reflection.AssemblyVersion("4.2.0.0")]

internal static class NativeRuntimeHost
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint STARTF_USESHOWWINDOW = 0x00000001;
    private const short SW_HIDE = 0;
    private const int SW_SHOW = 5;
    private const int SW_RESTORE = 9;
    private const uint WAIT_TIMEOUT = 258;
    private const uint EVENT_OBJECT_CREATE = 0x8000;
    private const uint EVENT_OBJECT_SHOW = 0x8002;
    private const uint EVENT_OBJECT_NAMECHANGE = 0x800C;
    private const uint WINEVENT_OUTOFCONTEXT = 0;
    private const int OBJID_WINDOW = 0;
    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x10;
    private const uint WM_SETICON = 0x0080;
    private const int GCLP_HICON = -14;
    private const int GCLP_HICONSM = -34;
    private const int JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    private static int targetProcessId;
    private static string title;
    private static string readyFile;
    private static IntPtr largeIcon;
    private static IntPtr smallIcon;
    private static readonly HashSet<IntPtr> hiddenWindows = new HashSet<IntPtr>();
    private static WinEventDelegate eventDelegate;
    private static EnumWindowsDelegate enumDelegate;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime);
    private delegate bool EnumWindowsDelegate(IntPtr window, IntPtr state);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string applicationName, string commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventDelegate callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsDelegate callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder value, int maximum);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int maximum);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetWindowText(IntPtr window, string value);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW", SetLastError = true)] private static extern IntPtr SetClassLongPtr64(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetClassLongW", SetLastError = true)] private static extern uint SetClassLong32(IntPtr window, int index, uint value);

    private static IntPtr SetClassIcon(IntPtr window, int index, IntPtr value)
    {
        return IntPtr.Size == 8 ? SetClassLongPtr64(window, index, value) : new IntPtr((long)SetClassLong32(window, index, unchecked((uint)value.ToInt32())));
    }

    private static Form CreateSplash(string iconPath)
    {
        Form splash = new Form();
        splash.Text = "旅策协同 · 正在启动";
        splash.FormBorderStyle = FormBorderStyle.None;
        splash.StartPosition = FormStartPosition.Manual;
        Rectangle virtualBounds = SystemInformation.VirtualScreen;
        Rectangle primaryBounds = Screen.PrimaryScreen.Bounds;
        splash.Bounds = virtualBounds;
        splash.BackColor = Color.FromArgb(246, 249, 249);
        splash.TopMost = true;
        splash.ShowInTaskbar = true;
        splash.Icon = new Icon(iconPath);

        Panel card = new Panel();
        card.Width = 520;
        card.Height = 250;
        card.Left = primaryBounds.Left - virtualBounds.Left + (primaryBounds.Width - card.Width) / 2;
        card.Top = primaryBounds.Top - virtualBounds.Top + (primaryBounds.Height - card.Height) / 2;
        card.Anchor = AnchorStyles.None;
        card.BackColor = Color.White;
        splash.Controls.Add(card);

        PictureBox mark = new PictureBox();
        mark.Width = 72;
        mark.Height = 72;
        mark.Left = (card.Width - mark.Width) / 2;
        mark.Top = 34;
        mark.SizeMode = PictureBoxSizeMode.Zoom;
        mark.Image = new Icon(iconPath, 64, 64).ToBitmap();
        card.Controls.Add(mark);

        Label name = new Label();
        name.AutoSize = false;
        name.Left = 20;
        name.Top = 116;
        name.Width = card.Width - 40;
        name.Height = 42;
        name.TextAlign = ContentAlignment.MiddleCenter;
        name.Font = new Font("Microsoft YaHei UI", 22, FontStyle.Bold);
        name.ForeColor = Color.FromArgb(22, 76, 90);
        name.Text = "旅策协同";
        card.Controls.Add(name);

        Label detail = new Label();
        detail.AutoSize = false;
        detail.Left = 20;
        detail.Top = 162;
        detail.Width = card.Width - 40;
        detail.Height = 30;
        detail.TextAlign = ContentAlignment.MiddleCenter;
        detail.Font = new Font("Microsoft YaHei UI", 10);
        detail.ForeColor = Color.FromArgb(76, 125, 126);
        detail.Text = "文旅智能辅助正在启动…";
        card.Controls.Add(detail);

        ProgressBar progress = new ProgressBar();
        progress.Style = ProgressBarStyle.Marquee;
        progress.MarqueeAnimationSpeed = 28;
        progress.Width = 300;
        progress.Height = 5;
        progress.Left = (card.Width - progress.Width) / 2;
        progress.Top = 208;
        card.Controls.Add(progress);
        return splash;
    }

    private static bool IsReady()
    {
        return File.Exists(readyFile);
    }

    private static void BrandWindow(IntPtr window)
    {
        if (window == IntPtr.Zero) return;
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        if (owner != (uint)targetProcessId) return;
        StringBuilder className = new StringBuilder(128);
        GetClassName(window, className, className.Capacity);
        // The runtime also creates message-only helpers for tray, hotkeys, IME
        // and framework events. Showing those helpers produces a blank window.
        // Only the real desktop surface uses the Tauri top-level class.
        if (!String.Equals(className.ToString(), "Tauri Window", StringComparison.Ordinal)) return;
        int currentLength = GetWindowTextLength(window);
        StringBuilder current = new StringBuilder(Math.Max(currentLength + 1, 2));
        GetWindowText(window, current, current.Capacity);
        if (!String.Equals(current.ToString(), title, StringComparison.Ordinal)) SetWindowText(window, title);
        SendMessage(window, WM_SETICON, new IntPtr(1), largeIcon);
        SendMessage(window, WM_SETICON, IntPtr.Zero, smallIcon);
        SetClassIcon(window, GCLP_HICON, largeIcon);
        SetClassIcon(window, GCLP_HICONSM, smallIcon);
        if (!IsReady())
        {
            hiddenWindows.Add(window);
            ShowWindow(window, SW_HIDE);
        }
        else if (hiddenWindows.Remove(window))
        {
            ShowWindow(window, SW_SHOW);
            ShowWindow(window, SW_RESTORE);
            SetForegroundWindow(window);
        }
    }

    private static void OnWindowEvent(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime)
    {
        if (objectId == OBJID_WINDOW && childId == 0) BrandWindow(window);
    }

    private static bool OnWindow(IntPtr window, IntPtr state)
    {
        BrandWindow(window);
        return true;
    }

    private static IntPtr CreateKillOnCloseJob(IntPtr process)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, pointer, (uint)size) || !AssignProcessToJobObject(job, process))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }
        finally { Marshal.FreeHGlobal(pointer); }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 4) return 64;
        string executable = Path.GetFullPath(args[0]);
        string icon = Path.GetFullPath(args[1]);
        title = args[2];
        readyFile = Path.GetFullPath(args[3]);
        if (!File.Exists(executable) || !File.Exists(icon) || String.IsNullOrWhiteSpace(title)) return 65;
        largeIcon = LoadImage(IntPtr.Zero, icon, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);
        smallIcon = LoadImage(IntPtr.Zero, icon, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
        if (largeIcon == IntPtr.Zero || smallIcon == IntPtr.Zero) return 66;
        Application.EnableVisualStyles();
        Form splash = CreateSplash(icon);
        splash.Show();
        splash.Refresh();
        Application.DoEvents();

        STARTUPINFO startup = new STARTUPINFO();
        startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        startup.dwFlags = STARTF_USESHOWWINDOW;
        startup.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION process;
        bool created = CreateProcess(executable, "\"" + executable + "\"", IntPtr.Zero, IntPtr.Zero, false, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out process);
        if (!created) return 67;

        IntPtr job = IntPtr.Zero;
        IntPtr hook = IntPtr.Zero;
        bool splashClosed = false;
        try
        {
            targetProcessId = process.dwProcessId;
            job = CreateKillOnCloseJob(process.hProcess);
            if (job == IntPtr.Zero)
            {
                TerminateProcess(process.hProcess, 68);
                return 68;
            }
            eventDelegate = new WinEventDelegate(OnWindowEvent);
            enumDelegate = new EnumWindowsDelegate(OnWindow);
            hook = SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, eventDelegate, (uint)targetProcessId, 0, WINEVENT_OUTOFCONTEXT);
            if (hook == IntPtr.Zero) return 69;
            if (ResumeThread(process.hThread) == UInt32.MaxValue) return 70;
            while (WaitForSingleObject(process.hProcess, 12) == WAIT_TIMEOUT)
            {
                EnumWindows(enumDelegate, IntPtr.Zero);
                Application.DoEvents();
                if (!splashClosed && IsReady())
                {
                    EnumWindows(enumDelegate, IntPtr.Zero);
                    Application.DoEvents();
                    System.Threading.Thread.Sleep(80);
                    splash.Close();
                    splashClosed = true;
                }
                System.Threading.Thread.Sleep(IsReady() ? 120 : 3);
            }
            EnumWindows(enumDelegate, IntPtr.Zero);
            uint exitCode;
            return GetExitCodeProcess(process.hProcess, out exitCode) ? unchecked((int)exitCode) : 71;
        }
        finally
        {
            if (!splashClosed) splash.Close();
            if (hook != IntPtr.Zero) UnhookWinEvent(hook);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
