// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.CommandLine;
using System.Threading.Tasks;

namespace PSRule.EditorServices;

static class Program
{
  /// <summary>
  /// Entry point for CLI tool.
  /// </summary>
  static async Task<int> Main(string[] args)
  {
    return await ClientBuilder.New().InvokeAsync(args);
  }
}
