import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Player } from '@lottiefiles/react-lottie-player'
import lottieSuccess from "@/public/json/success.json";

const SuccessModal = ({ openSuccess, setOpenSuccess }: { openSuccess: boolean; setOpenSuccess: (c:boolean) => void }) => {
    return (
        <Dialog open={openSuccess} onOpenChange={setOpenSuccess}>
            <DialogContent className="max-w-lg bg-white">
                <DialogHeader>
                    <DialogTitle className="mb-[20px]">
                        Claimed
                    </DialogTitle>
                    <Player
                        keepLastFrame
                        autoplay
                        src={lottieSuccess}
                        style={{ height: "300px", width: "300px" }}
                    ></Player>
                    {/* <button
                        className="flex items-center m-2 py-2 px-2 bg-white text-[#218B53] border-2 border-[#218B53] rounded-lg font-semibold hover:bg-[#218B53] hover:text-white"
                        onClick={() => setOpenSuccess(false)}
                    >
                        Done
                    </button> */}
                </DialogHeader>
            </DialogContent>
        </Dialog>
    )
}

export default SuccessModal