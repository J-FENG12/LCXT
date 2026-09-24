using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("旅策协同一键启动")]
[assembly: AssemblyProduct("旅策协同 Travel.AI")]
[assembly: AssemblyCompany("旅策协同")]
[assembly: AssemblyVersion("4.2.0.0")]

internal static class DesktopOneClickLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "runtime", "bin", "node.exe");
            string launcher = Path.Combine(root, "launcher.cjs");
            string native = Path.Combine(root, "runtime", "旅策协同.exe");
            string frontend = Path.Combine(root, "dist", "index-v4.js");
            foreach (string required in new[] { node, launcher, native, frontend })
            {
                if (!File.Exists(required))
                    throw new FileNotFoundException("演示包不完整，请重新解压整个文件夹。", required);
            }

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = node;
            start.Arguments = "\"" + launcher + "\"";
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.EnvironmentVariables["TRAVEL_SUBMISSION_MODE"] = "1";
            using (Process child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("本机服务未能启动。");
                child.WaitForExit();
                if (child.ExitCode != 0)
                    MessageBox.Show("旅策协同未正常启动或已异常退出。请检查本目录 logs 下的启动日志，并确认没有运行中的旧实例。", "旅策协同", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "旅策协同启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
