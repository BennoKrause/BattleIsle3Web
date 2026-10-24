// Ghidra headless pre-step for Watcom-compiled binaries without frame-pointer prologues:
// scans the code blocks for "call rel32" instructions and creates functions at all targets that
// lie inside executable blocks, then disassembles them.
// @category Export
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import java.util.*;

public class FindFuncs extends GhidraScript {
  @Override
  public void run() throws Exception {
    Memory mem = currentProgram.getMemory();
    Set<Long> targets = new TreeSet<>();
    for (MemoryBlock b : mem.getBlocks()) {
      if (!b.isExecute() || !b.isInitialized()) continue;
      byte[] data = new byte[(int) b.getSize()];
      b.getBytes(b.getStart(), data);
      long base = b.getStart().getOffset();
      for (int i = 0; i + 5 <= data.length; i++) {
        if ((data[i] & 0xff) != 0xe8) continue;
        int rel = (data[i + 1] & 0xff) | ((data[i + 2] & 0xff) << 8) | ((data[i + 3] & 0xff) << 16) | ((data[i + 4] & 0xff) << 24);
        long t = base + i + 5 + rel;
        Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(t);
        MemoryBlock tb = mem.getBlock(a);
        if (tb != null && tb.isExecute()) targets.add(t);
      }
    }
    println("call targets: " + targets.size());
    int n = 0;
    for (long t : targets) {
      Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(t);
      if (currentProgram.getFunctionManager().getFunctionAt(a) != null) continue;
      new DisassembleCommand(a, null, true).applyTo(currentProgram, monitor);
      if (new CreateFunctionCmd(a).applyTo(currentProgram, monitor)) n++;
    }
    println("created functions: " + n);
  }
}
