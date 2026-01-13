import { ChevronRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'

function App() {
  const [did, setDid] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!did.trim()) return

    setLoading(true)

    try {
      const response = await fetch('/increment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: did.trim()
        })
      })
      const data = await response.json()

      if (response.ok) {
        toast.success('Tokens sent successfully!', {
          duration: 4000,
          position: 'top-center',
        })
        setDid('')
      } else {
        toast.error(data.message || 'Failed to send tokens', {
          duration: 4000,
          position: 'top-center',
        })
      }
    } catch (error) {
      console.error('API Error:', error)
      toast.error('Failed to connect to the faucet. Please try again.', {
        duration: 4000,
        position: 'top-center',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Toaster />
      <div className="w-full min-h-screen flex items-center justify-center p-5 bg-[#f5f5f5]">
        <div className="w-full max-w-[700px] text-center flex flex-col items-center rounded-2xl">
          <div className="flex items-center mb-5">
            <img src="/logo.png" alt="Rubix Logo" className="flex items-center justify-center" width={200} height={200} />
          </div>
          <p className="text-[35px] font-bold text-black m-0 tracking-tight">Rubix Faucet</p>
          <p className="text-base text-[#666666] m-0 mb-4 ">Get test Rubix tokens for the testnet</p>

          <form onSubmit={handleSubmit} className="w-full flex gap-3 mt-4 max-sm:flex-col">
            <input
              type="text"
              placeholder="Enter your DID"
              value={did}
              onChange={(e) => setDid(e.target.value)}
              className="flex-1 px-5 py-3 text-[15px] border border-[#e0e0e0] rounded-lg bg-white text-black outline-none transition-all duration-300 placeholder:text-[#999999] focus:border-primary focus:shadow-[0_0_0_3px_rgba(248,228,45,0.1)] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[#f5f5f5]"
              disabled={loading}
            />
            <button
              type="submit"
              className="px-4 py-3 text-[15px] font-semibold text-white rounded-lg cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 whitespace-nowrap border-none hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none max-sm:justify-center"
              style={{ backgroundColor: '#003500' }}
              disabled={loading || !did.trim()}
            >
              {loading ?
                <Loader2 className="w-4 h-4 animate-spin" />

                : 'Get RBT'}
              {!loading && (
                <ChevronRight height={18} width={18} />
              )}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

export default App
